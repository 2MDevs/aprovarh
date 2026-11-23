import type { PoolClient } from 'pg';
import { auditar } from '../../core/audit.ts';
import { cfg } from '../../core/settings.ts';
import { pool, transaction } from '../../db/pool.ts';
import { type ArquivoGuardado, descartarArquivos, guardarArquivo, type TipoAceito } from '../../lib/arquivos.ts';
import { encrypt, hmac, sha256 } from '../../lib/crypto.ts';
import { publicar } from '../../core/tempoReal.ts';

export interface NovaCandidatura {
  nome: string;
  sobrenome: string;
  cpf: string;            // só dígitos, já validado
  telefone: string;       // +55..., já normalizado
  unidadeId: string;
  curriculo: { conteudo: Buffer; nome: string; tipo: TipoAceito };
  foto: { conteudo: Buffer; nome: string; tipo: TipoAceito } | null; // opcional
  avisoVersao: string;
  ip: string;
}

/** Versão do aviso de privacidade = começo do SHA-256 do texto. Mudou o texto, muda a versão. */
export async function avisoAtual(): Promise<{ texto: string; versao: string; contato: string | null } | null> {
  const texto = (await cfg('privacidade.aviso'))?.trim();
  if (!texto) return null;
  return { texto, versao: sha256(texto).slice(0, 12), contato: await cfg('privacidade.controlador') };
}

const ATOR_FORMULARIO = { usuarioNome: 'Formulário público de candidatura' };

/** Avisa no sino quem atende candidatos daquela unidade. */
export async function notificarGestoras(db: PoolClient, unidadeId: string, titulo: string, texto: string, link: string) {
  await db.query(
    `INSERT INTO notificacoes (usuario_id, tipo, titulo, texto, link)
     SELECT u.id, 'candidatura', $2, $3, $4
       FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
      WHERE u.excluido_em IS NULL AND u.situacao = 'ativo'
        AND ('candidatos.ver' = ANY(p.permissoes) OR p.chave = 'desenvolvedor')
        AND (u.todas_unidades OR p.chave IN ('diretoria', 'desenvolvedor')
             OR EXISTS (SELECT 1 FROM usuario_unidades uu WHERE uu.usuario_id = u.id AND uu.unidade_id = $1))`,
    [unidadeId, titulo, texto, link],
  );
}

/**
 * Registra a candidatura. Regra de cadastro repetido pelo CPF (uma pessoa = uma ficha):
 * - CPF novo → cria a ficha, a conversa, o status inicial e a linha do tempo;
 * - CPF com candidatura em andamento → não cria outra ficha; registra o envio e os arquivos novos e avisa a gestora;
 * - CPF com candidatura encerrada (status final) → reabre a mesma ficha com o status inicial.
 * Um envio repetido nunca altera nome, telefone ou unidade da ficha (ver migration 002).
 * O candidato recebe sempre a mesma resposta, para não revelar se o CPF já estava cadastrado.
 */
export async function registrarCandidatura(c: NovaCandidatura): Promise<{ tipo: 'nova' | 'repetida' | 'reaberta'; codigo: string; candidatoId: string; telefoneDiferente: boolean }> {
  const gravados: ArquivoGuardado[] = [];
  const cpfHash = hmac(`cpf:${c.cpf}`);
  try {
    return await transaction(async (db) => {
      // Dois envios simultâneos do mesmo CPF entram um de cada vez.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [cpfHash]);

      const unidade = await db.query<{ nome: string }>('SELECT nome FROM unidades WHERE id = $1 AND ativa AND excluido_em IS NULL', [c.unidadeId]);
      if (!unidade.rowCount) throw new Error('UNIDADE_INVALIDA');

      const curriculo = await guardarArquivo(db, c.curriculo.conteudo, c.curriculo.nome, c.curriculo.tipo);
      gravados.push(curriculo);
      const foto = c.foto ? await guardarArquivo(db, c.foto.conteudo, c.foto.nome, c.foto.tipo) : null;
      if (foto) gravados.push(foto);

      const existente = await db.query<{ id: string; codigo: string; telefone_hash: string; unidade_id: string; status_id: string; final: boolean }>(
        `SELECT c.id, c.codigo, c.telefone_hash, c.unidade_id, c.status_id, s.final
           FROM candidatos c JOIN status s ON s.id = c.status_id
          WHERE c.cpf_hash = $1 AND c.excluido_em IS NULL FOR UPDATE OF c`,
        [cpfHash],
      );
      const statusNovo = await db.query<{ id: string; etapa_portal: string; situacao_portal: string }>(
        `SELECT id, etapa_portal, situacao_portal FROM status WHERE chave_sistema = 'novo'`,
      );
      const inicial = statusNovo.rows[0];
      const nomeCompleto = `${c.nome} ${c.sobrenome}`;
      const telefoneHash = hmac(`tel:${c.telefone}`);

      let candidatoId: string;
      let codigo: string;
      let tipo: 'nova' | 'repetida' | 'reaberta';
      let telefoneDiferente = false;
      let unidadeDiferente = false;

      // Pré-cadastro do RH com o mesmo telefone, ainda pendente (o candidato usou o formulário comum em vez do convite):
      // completa essa ficha em vez de criar outra.
      const pendente = existente.rowCount ? null : (await db.query<{ id: string; codigo: string }>(
        'SELECT id, codigo FROM candidatos WHERE telefone_hash = $1 AND cadastro_pendente AND excluido_em IS NULL LIMIT 1 FOR UPDATE',
        [telefoneHash],
      )).rows[0];

      if (pendente) {
        tipo = 'nova';
        candidatoId = pendente.id;
        codigo = pendente.codigo;
        await db.query(
          `UPDATE candidatos SET nome = $2, sobrenome = $3, cpf = $4, cpf_hash = $5, cpf_final = $6, unidade_id = $7,
             foto_id = COALESCE($8, foto_id), curriculo_id = $9, consentimento_em = now(), aviso_versao = $10,
             cadastro_pendente = false, cadastro_completo_em = now(), convite_token_hash = NULL, atualizado_em = now()
           WHERE id = $1`,
          [candidatoId, c.nome, c.sobrenome, encrypt(c.cpf), cpfHash, c.cpf.slice(-2), c.unidadeId, foto?.id ?? null, curriculo.id, c.avisoVersao],
        );
      } else if (!existente.rowCount) {
        tipo = 'nova';
        const r = await db.query<{ id: string; codigo: string }>(
          `INSERT INTO candidatos (nome, sobrenome, cpf, cpf_hash, cpf_final, telefone, telefone_hash, telefone_final,
             unidade_id, status_id, foto_id, curriculo_id, consentimento_em, aviso_versao)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13) RETURNING id, codigo`,
          [c.nome, c.sobrenome, encrypt(c.cpf), cpfHash, c.cpf.slice(-2), encrypt(c.telefone), telefoneHash, c.telefone.slice(-4),
            c.unidadeId, inicial.id, foto?.id ?? null, curriculo.id, c.avisoVersao],
        );
        candidatoId = r.rows[0].id;
        codigo = r.rows[0].codigo;
        await db.query('INSERT INTO conversas (candidato_id) VALUES ($1)', [candidatoId]);
        await db.query(
          `INSERT INTO status_historico (candidato_id, status_novo_id, autor_tipo, autor_nome, motivo)
           VALUES ($1, $2, 'sistema', 'Sistema', 'Candidatura recebida pelo formulário')`,
          [candidatoId, inicial.id],
        );
        await gravarLinhaDoTempoInicial(db, candidatoId, inicial);
      } else {
        const atual = existente.rows[0];
        candidatoId = atual.id;
        codigo = atual.codigo;
        telefoneDiferente = atual.telefone_hash !== telefoneHash;
        unidadeDiferente = atual.unidade_id !== c.unidadeId;
        tipo = atual.final ? 'reaberta' : 'repetida';
        if (tipo === 'reaberta') {
          await db.query('UPDATE candidatos SET status_id = $2, consentimento_em = now(), aviso_versao = $3, atualizado_em = now() WHERE id = $1', [candidatoId, inicial.id, c.avisoVersao]);
          await db.query(
            `INSERT INTO status_historico (candidato_id, status_anterior_id, status_novo_id, autor_tipo, autor_nome, motivo)
             VALUES ($1, $2, $3, 'sistema', 'Sistema', 'Nova candidatura depois de um processo encerrado')`,
            [candidatoId, atual.status_id, inicial.id],
          );
          await gravarLinhaDoTempoInicial(db, candidatoId, inicial);
        } else {
          await db.query('UPDATE candidatos SET consentimento_em = now(), aviso_versao = $2 WHERE id = $1', [candidatoId, c.avisoVersao]);
        }
        await db.query('INSERT INTO conversas (candidato_id) VALUES ($1) ON CONFLICT (candidato_id) DO NOTHING', [candidatoId]);
      }

      await db.query(
        `UPDATE candidatos SET candidatura_em = now(), ultima_interacao_em = now() WHERE id = $1`,
        [candidatoId],
      );
      await db.query(
        `INSERT INTO candidaturas (candidato_id, unidade_id, tipo, nome_informado, telefone_informado, telefone_diferente, unidade_diferente, curriculo_id, foto_id, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [candidatoId, c.unidadeId, tipo, nomeCompleto, encrypt(c.telefone), telefoneDiferente, unidadeDiferente, curriculo.id, foto?.id ?? null, c.ip],
      );
      await db.query(`INSERT INTO candidato_arquivos (candidato_id, arquivo_id, tipo) VALUES ($1, $2, 'curriculo')`, [candidatoId, curriculo.id]);
      if (foto) await db.query(`INSERT INTO candidato_arquivos (candidato_id, arquivo_id, tipo) VALUES ($1, $2, 'foto')`, [candidatoId, foto.id]);
      await db.query(
        `INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)`,
        [tipo === 'repetida' ? 'candidato.candidatura_repetida' : 'candidato.cadastrado', candidatoId, JSON.stringify({ unidadeId: c.unidadeId, tipo })],
      );

      // Aviso automático na conversa (histórico da Central; não aparece para o candidato).
      const textoSistema = { nova: 'Candidatura recebida pelo formulário.', repetida: 'O candidato enviou a candidatura de novo.', reaberta: 'O candidato voltou a se candidatar. Processo reaberto como "Novo candidato".' }[tipo];
      const msg = await db.query<{ id: string; criado_em: Date }>(
        `INSERT INTO mensagens (conversa_id, sentido, canal, autor_tipo, autor_nome, texto, visivel_ao_candidato)
         SELECT id, 'entrada', 'sistema', 'sistema', 'Sistema', $2, false FROM conversas WHERE candidato_id = $1 RETURNING id, criado_em`,
        [candidatoId, encrypt(textoSistema)],
      );
      await db.query('UPDATE conversas SET ultima_mensagem_id = $2, ultima_mensagem_em = $3 WHERE candidato_id = $1', [candidatoId, msg.rows[0].id, msg.rows[0].criado_em]);
      await publicar(db, { tipo: 'candidatura.nova', candidatoId, unidadeId: existente.rowCount ? existente.rows[0].unidade_id : c.unidadeId });

      const avisos = [telefoneDiferente && 'telefone diferente do cadastro', unidadeDiferente && `pediu a unidade ${unidade.rows[0].nome}`].filter(Boolean).join('; ');
      const titulo = { nova: 'Nova candidatura', repetida: 'Candidatura enviada de novo', reaberta: 'Candidato voltou a se candidatar' }[tipo];
      await notificarGestoras(db, c.unidadeId, titulo, `${nomeCompleto} (${codigo}) · ${unidade.rows[0].nome}${avisos ? ` · atenção: ${avisos}` : ''}`, `/candidatos/${candidatoId}`);

      await auditar({
        acao: `candidatura.${tipo === 'nova' ? 'recebida' : tipo}`,
        resultado: 'sucesso',
        item: { tipo: 'candidato', id: candidatoId, nome: `${nomeCompleto} (${codigo})` },
        detalhes: { unidade: unidade.rows[0].nome, telefoneDiferente, unidadeDiferente, avisoVersao: c.avisoVersao },
        ator: ATOR_FORMULARIO,
        ip: c.ip,
      }, db);

      return { tipo, codigo, candidatoId, telefoneDiferente };
    });
  } catch (err) {
    await descartarArquivos(gravados); // a transação foi desfeita: os arquivos também saem do disco
    throw err;
  }
}

export async function gravarLinhaDoTempoInicial(db: PoolClient, candidatoId: string, inicial: { etapa_portal: string; situacao_portal: string }) {
  const etapas = ['candidatura', 'analise', 'entrevista', 'resultado'];
  const posicao = etapas.indexOf(inicial.etapa_portal);
  for (const [i, etapa] of etapas.entries()) {
    const situacao = etapa === 'candidatura' ? 'concluida' : i === posicao ? inicial.situacao_portal : i < posicao ? 'concluida' : 'nao_iniciada';
    await db.query(
      `INSERT INTO etapas_candidato (candidato_id, etapa, situacao, origem) VALUES ($1, $2, $3, 'automatica')
       ON CONFLICT (candidato_id, etapa) DO UPDATE SET situacao = EXCLUDED.situacao, origem = 'automatica', atualizado_por = NULL, atualizado_em = now()`,
      [candidatoId, etapa, situacao],
    );
  }
}

export async function unidadesAbertas() {
  const { rows } = await pool.query<{ id: string; nome: string }>('SELECT id, nome FROM unidades WHERE ativa AND excluido_em IS NULL ORDER BY nome');
  return rows;
}

// ── Convite do pré-cadastro (D47) ─────────────────────────────────────────

export interface Convite { candidatoId: string; nome: string; sobrenome: string; unidadeId: string; telefoneFinal: string; curriculoNome: string | null }

/** Convite válido: pendente, dentro da validade. O token nunca é guardado, só o hash. */
export async function lerConvite(token: string, db: { query: PoolClient['query'] } = pool, travar = false): Promise<Convite | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const r = await db.query(
    `SELECT c.id, c.nome, c.sobrenome, c.unidade_id, c.telefone_final, a.nome_original
       FROM candidatos c LEFT JOIN arquivos a ON a.id = c.curriculo_id
      WHERE c.convite_token_hash = $1 AND c.cadastro_pendente AND c.excluido_em IS NULL AND c.convite_expira_em > now()
      ${travar ? 'FOR UPDATE OF c' : ''}`,
    [hmac(`convite:${token}`)],
  );
  const c = r.rows[0];
  return c ? { candidatoId: c.id, nome: c.nome, sobrenome: c.sobrenome, unidadeId: c.unidade_id, telefoneFinal: c.telefone_final, curriculoNome: c.nome_original } : null;
}

export interface CompletarConvite {
  token: string;
  nome: string;
  sobrenome: string;
  cpf: string;
  unidadeId: string;
  curriculo?: { conteudo: Buffer; nome: string; tipo: TipoAceito } | null;
  foto?: { conteudo: Buffer; nome: string; tipo: TipoAceito } | null;
  avisoVersao: string;
  ip: string;
}

/**
 * O candidato completa o pré-cadastro pelo link do convite. Devolve a ficha final (para abrir o portal).
 * - CPF novo: a ficha do pré-cadastro vira ficha completa (CPF, aceite do aviso, foto se mandou).
 * - CPF que já tinha ficha: a candidatura entra nessa ficha; o currículo e a conversa do pré-cadastro vão junto
 *   e o pré-cadastro é encerrado (uma pessoa = uma ficha).
 * O telefone é o do convite (foi por ele que o link chegou); o candidato não troca aqui.
 */
export async function completarConvite(c: CompletarConvite): Promise<{ candidatoId: string; unidadeId: string; nome: string; convidadoPor: string | null } | null> {
  const gravados: ArquivoGuardado[] = [];
  const cpfHash = hmac(`cpf:${c.cpf}`);
  try {
    return await transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [cpfHash]);
      const conv = await lerConvite(c.token, db, true);
      if (!conv) return null;
      const pre = (await db.query<{ telefone: string; telefone_hash: string; convite_enviado_por: string | null; curriculo_id: string | null }>(
        'SELECT telefone, telefone_hash, convite_enviado_por, curriculo_id FROM candidatos WHERE id = $1', [conv.candidatoId],
      )).rows[0];
      const unidade = await db.query<{ nome: string }>('SELECT nome FROM unidades WHERE id = $1 AND ativa AND excluido_em IS NULL', [c.unidadeId]);
      if (!unidade.rowCount) throw new Error('UNIDADE_INVALIDA');

      const curriculo = c.curriculo ? await guardarArquivo(db, c.curriculo.conteudo, c.curriculo.nome, c.curriculo.tipo) : null;
      if (curriculo) gravados.push(curriculo);
      const foto = c.foto ? await guardarArquivo(db, c.foto.conteudo, c.foto.nome, c.foto.tipo) : null;
      if (foto) gravados.push(foto);

      const outra = await db.query<{ id: string; codigo: string; unidade_id: string }>(
        'SELECT id, codigo, unidade_id FROM candidatos WHERE cpf_hash = $1 AND excluido_em IS NULL AND id <> $2 FOR UPDATE',
        [cpfHash, conv.candidatoId],
      );
      const nomeCompleto = `${c.nome} ${c.sobrenome}`;
      let alvo = conv.candidatoId;
      let unidadeAlvo = c.unidadeId;
      let unificada: string | null = null;

      if (!outra.rowCount) {
        await db.query(
          `UPDATE candidatos SET nome = $2, sobrenome = $3, cpf = $4, cpf_hash = $5, cpf_final = $6, unidade_id = $7,
             foto_id = COALESCE($8, foto_id), curriculo_id = COALESCE($9, curriculo_id), consentimento_em = now(), aviso_versao = $10,
             cadastro_pendente = false, cadastro_completo_em = now(), convite_token_hash = NULL,
             candidatura_em = now(), ultima_interacao_em = now(), atualizado_em = now()
           WHERE id = $1`,
          [alvo, c.nome, c.sobrenome, encrypt(c.cpf), cpfHash, c.cpf.slice(-2), c.unidadeId, foto?.id ?? null, curriculo?.id ?? null, c.avisoVersao],
        );
      } else {
        // Já existia uma ficha com esse CPF: a candidatura vai para ela.
        const o = outra.rows[0];
        alvo = o.id;
        unidadeAlvo = o.unidade_id;
        unificada = o.codigo;
        await db.query('UPDATE candidatos SET consentimento_em = now(), aviso_versao = $2, candidatura_em = now(), ultima_interacao_em = now() WHERE id = $1', [alvo, c.avisoVersao]);
        await db.query('INSERT INTO conversas (candidato_id) VALUES ($1) ON CONFLICT (candidato_id) DO NOTHING', [alvo]);
        await db.query(
          `UPDATE mensagens SET conversa_id = (SELECT id FROM conversas WHERE candidato_id = $2)
            WHERE conversa_id = (SELECT id FROM conversas WHERE candidato_id = $1)`, [conv.candidatoId, alvo],
        );
        await db.query(
          `INSERT INTO candidato_arquivos (candidato_id, arquivo_id, tipo, enviado_por, criado_em)
           SELECT $2, arquivo_id, tipo, enviado_por, criado_em FROM candidato_arquivos WHERE candidato_id = $1 ON CONFLICT DO NOTHING`,
          [conv.candidatoId, alvo],
        );
        await db.query(
          `UPDATE candidatos SET excluido_em = now(), cadastro_pendente = true, convite_token_hash = NULL, atualizado_em = now() WHERE id = $1`,
          [conv.candidatoId],
        );
      }

      await db.query(
        `INSERT INTO candidaturas (candidato_id, unidade_id, tipo, nome_informado, telefone_informado, telefone_diferente, unidade_diferente, curriculo_id, foto_id, ip)
         VALUES ($1,$2,'convite',$3,$4,$5,$6,$7,$8,$9)`,
        [alvo, c.unidadeId, nomeCompleto, pre.telefone, false, unidadeAlvo !== c.unidadeId, curriculo?.id ?? pre.curriculo_id, foto?.id ?? null, c.ip],
      );
      const novos = [curriculo && [curriculo.id, 'curriculo'], foto && [foto.id, 'foto']].filter(Boolean) as [string, string][];
      for (const [id, tipo] of novos) {
        await db.query(`INSERT INTO candidato_arquivos (candidato_id, arquivo_id, tipo) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [alvo, id, tipo]);
      }
      // Evento próprio: a automação de "nova candidatura" (confirmação pelo WhatsApp) não dispara de novo para quem veio por convite.
      await db.query('INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)',
        ['candidato.cadastro_completado', alvo, JSON.stringify({ unidadeId: c.unidadeId, unificadaCom: unificada })]);

      const textoSistema = unificada
        ? `O candidato completou o cadastro pelo convite. O CPF já tinha esta ficha: o pré-cadastro foi unificado aqui.`
        : 'O candidato completou o cadastro pelo convite e aceitou o aviso de privacidade.';
      const msg = await db.query<{ id: string; criado_em: Date }>(
        `INSERT INTO mensagens (conversa_id, sentido, canal, autor_tipo, autor_nome, texto, visivel_ao_candidato)
         SELECT id, 'entrada', 'sistema', 'sistema', 'Sistema', $2, false FROM conversas WHERE candidato_id = $1 RETURNING id, criado_em`,
        [alvo, encrypt(textoSistema)],
      );
      await db.query('UPDATE conversas SET ultima_mensagem_id = $2, ultima_mensagem_em = $3 WHERE candidato_id = $1', [alvo, msg.rows[0].id, msg.rows[0].criado_em]);
      await publicar(db, { tipo: 'candidatura.nova', candidatoId: alvo, unidadeId: unidadeAlvo });
      await notificarGestoras(db, unidadeAlvo, 'Cadastro completado pelo convite', `${nomeCompleto} · ${unidade.rows[0].nome}${unificada ? ` · unificado com ${unificada}` : ''}`, `/conversas?c=${alvo}`);
      await auditar({
        acao: 'candidatura.convite_completado', resultado: 'sucesso', item: { tipo: 'candidato', id: alvo, nome: nomeCompleto },
        detalhes: { unidade: unidade.rows[0].nome, unificadaCom: unificada, avisoVersao: c.avisoVersao }, ator: ATOR_FORMULARIO, ip: c.ip,
      }, db);
      return { candidatoId: alvo, unidadeId: unidadeAlvo, nome: c.nome, convidadoPor: pre.convite_enviado_por };
    });
  } catch (err) {
    await descartarArquivos(gravados);
    throw err;
  }
}
