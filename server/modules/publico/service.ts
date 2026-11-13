import type { PoolClient } from 'pg';
import { auditar } from '../../core/audit.ts';
import { cfg } from '../../core/settings.ts';
import { pool, transaction } from '../../db/pool.ts';
import { type ArquivoGuardado, descartarArquivos, guardarArquivo, type TipoAceito } from '../../lib/arquivos.ts';
import { encrypt, hmac, sha256 } from '../../lib/crypto.ts';

export interface NovaCandidatura {
  nome: string;
  sobrenome: string;
  cpf: string;            // só dígitos, já validado
  telefone: string;       // +55..., já normalizado
  unidadeId: string;
  curriculo: { conteudo: Buffer; nome: string; tipo: TipoAceito };
  foto: { conteudo: Buffer; nome: string; tipo: TipoAceito };
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
async function notificarGestoras(db: PoolClient, unidadeId: string, titulo: string, texto: string, link: string) {
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
export async function registrarCandidatura(c: NovaCandidatura): Promise<{ tipo: 'nova' | 'repetida' | 'reaberta'; codigo: string }> {
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
      const foto = await guardarArquivo(db, c.foto.conteudo, c.foto.nome, c.foto.tipo);
      gravados.push(foto);

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

      if (!existente.rowCount) {
        tipo = 'nova';
        const r = await db.query<{ id: string; codigo: string }>(
          `INSERT INTO candidatos (nome, sobrenome, cpf, cpf_hash, cpf_final, telefone, telefone_hash, telefone_final,
             unidade_id, status_id, foto_id, curriculo_id, consentimento_em, aviso_versao)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13) RETURNING id, codigo`,
          [c.nome, c.sobrenome, encrypt(c.cpf), cpfHash, c.cpf.slice(-2), encrypt(c.telefone), telefoneHash, c.telefone.slice(-4),
            c.unidadeId, inicial.id, foto.id, curriculo.id, c.avisoVersao],
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
        [candidatoId, c.unidadeId, tipo, nomeCompleto, encrypt(c.telefone), telefoneDiferente, unidadeDiferente, curriculo.id, foto.id, c.ip],
      );
      await db.query(
        `INSERT INTO candidato_arquivos (candidato_id, arquivo_id, tipo) VALUES ($1, $2, 'curriculo'), ($1, $3, 'foto')`,
        [candidatoId, curriculo.id, foto.id],
      );
      await db.query(
        `INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)`,
        [tipo === 'repetida' ? 'candidato.candidatura_repetida' : 'candidato.cadastrado', candidatoId, JSON.stringify({ unidadeId: c.unidadeId, tipo })],
      );

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

      return { tipo, codigo };
    });
  } catch (err) {
    await descartarArquivos(gravados); // a transação foi desfeita: os arquivos também saem do disco
    throw err;
  }
}

async function gravarLinhaDoTempoInicial(db: PoolClient, candidatoId: string, inicial: { etapa_portal: string; situacao_portal: string }) {
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
