import { Router } from 'express';
import { z } from 'zod';
import { enxergaUnidade, filtroUnidades, pode } from '../../core/access.ts';
import { auditarReq } from '../../core/audit.ts';
import { pool, transaction } from '../../db/pool.ts';
import { lerArquivo } from '../../lib/arquivos.ts';
import { encrypt, hmac } from '../../lib/crypto.ts';
import { capitalizarNome, nomeValido, normalizarTelefone, soDigitos } from '../../lib/documentos.ts';
import { badRequest, forbidden, h, ipDe, notFound, parse } from '../../lib/http.ts';
import { exigirLogin, exigirPermissao } from '../../middleware/auth.ts';
import { env } from '../../config/env.ts';
import { liberarAcesso, revogarAcesso } from '../portal/servico.ts';
import {
  avisarMudanca, candidatoVisivel, decifrarSeguro, ETAPAS, formatarTelefone, mascararCpf, mascararTelefone,
  recalcularLinhaDoTempo, registrarEvento,
} from './service.ts';

/** Central de RH › candidatos. Tudo filtrado pelas unidades que a pessoa enxerga. */
export const candidatosRouter = Router();
candidatosRouter.use(exigirLogin(), exigirPermissao('candidatos.ver'));

const uuid = z.string().uuid();
const autor = (req: Express.Request) => ({ tipo: 'usuario' as const, id: req.usuario!.id, nome: req.usuario!.nome });

// ── Lista (estilo WhatsApp Web) ────────────────────────────────────────────
const filtros = z.object({
  busca: z.string().trim().max(100).optional(),
  unidadeId: uuid.optional(),
  statusId: uuid.optional(),
  tagId: uuid.optional(),
  de: z.string().datetime({ offset: true }).optional(),
  ate: z.string().datetime({ offset: true }).optional(),
  naoLidas: z.enum(['1']).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(10).max(100).default(40),
});

candidatosRouter.get('/', h(async (req, res) => {
  const f = parse(filtros, req.query);
  const u = req.usuario!;
  if (f.unidadeId && !enxergaUnidade(u, f.unidadeId)) throw forbidden('Você não tem acesso a esta unidade.');
  const p: unknown[] = [u.id, filtroUnidades(u)];
  const cond = ['c.excluido_em IS NULL', '($2::uuid[] IS NULL OR c.unidade_id = ANY($2))'];
  const add = (sql: string, v: unknown) => {
    p.push(v);
    cond.push(sql.replaceAll('?', `$${p.length}`));
  };
  if (f.unidadeId) add('c.unidade_id = ?', f.unidadeId);
  if (f.statusId) add('c.status_id = ?', f.statusId);
  if (f.tagId) add('EXISTS (SELECT 1 FROM candidato_tags ct WHERE ct.candidato_id = c.id AND ct.tag_id = ?)', f.tagId);
  if (f.de) add('c.candidatura_em >= ?', f.de);
  if (f.ate) add('c.candidatura_em <= ?', f.ate);
  if (f.busca) {
    const digitos = soDigitos(f.busca);
    const tel = digitos.length >= 10 ? normalizarTelefone(digitos) : null;
    if (digitos.length === 11 && digitos === f.busca.replace(/[.\-\s()]/g, '')) {
      // CPF ou celular digitado: compara pelos hashes (os dados ficam cifrados).
      p.push(hmac(`cpf:${digitos}`), tel ? hmac(`tel:${tel}`) : '-');
      cond.push(`(c.cpf_hash = $${p.length - 1} OR c.telefone_hash = $${p.length})`);
    } else if (tel) {
      add('c.telefone_hash = ?', hmac(`tel:${tel}`));
    } else {
      add(`(c.nome || ' ' || c.sobrenome ILIKE ? OR c.codigo ILIKE ?)`, `%${f.busca.replace(/[%_]/g, '')}%`);
    }
  }
  const naoLidas = `(SELECT count(*)::int FROM mensagens mm WHERE mm.conversa_id = cv.id AND mm.sentido = 'entrada'
                      AND mm.criado_em > COALESCE(cl.lida_ate, '-infinity'::timestamptz))`;
  if (f.naoLidas) cond.push(`${naoLidas} > 0`);

  const where = cond.join(' AND ');
  const base = `FROM candidatos c
      JOIN unidades un ON un.id = c.unidade_id
      JOIN status s ON s.id = c.status_id
      LEFT JOIN conversas cv ON cv.candidato_id = c.id
      LEFT JOIN mensagens m ON m.id = cv.ultima_mensagem_id
      LEFT JOIN conversa_leituras cl ON cl.conversa_id = cv.id AND cl.usuario_id = $1
     WHERE ${where}`;
  const [lista, total] = await Promise.all([
    pool.query(
      `SELECT c.id, c.codigo, c.nome, c.sobrenome, c.unidade_id, un.nome AS unidade, c.status_id, s.nome AS status, s.cor AS status_cor,
              c.foto_id, c.candidatura_em, c.ultima_interacao_em, m.texto AS ult_texto, m.arquivo_id AS ult_arquivo,
              m.autor_tipo AS ult_autor, m.criado_em AS ult_em, ${naoLidas} AS nao_lidas,
              COALESCE((SELECT json_agg(json_build_object('id', t.id, 'nome', t.nome, 'cor', t.cor) ORDER BY t.nome)
                          FROM candidato_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.candidato_id = c.id AND t.ativa), '[]') AS tags
         ${base} ORDER BY c.ultima_interacao_em DESC LIMIT ${f.porPagina} OFFSET ${(f.pagina - 1) * f.porPagina}`,
      p,
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n ${base}`, p),
  ]);
  res.json({
    total: total.rows[0].n,
    pagina: f.pagina,
    porPagina: f.porPagina,
    candidatos: lista.rows.map((r) => ({
      id: r.id, codigo: r.codigo, nome: `${r.nome} ${r.sobrenome}`, unidade: { id: r.unidade_id, nome: r.unidade },
      status: { id: r.status_id, nome: r.status, cor: r.status_cor }, fotoId: r.foto_id, tags: r.tags,
      candidaturaEm: r.candidatura_em, ultimaInteracaoEm: r.ultima_interacao_em, naoLidas: r.nao_lidas,
      ultimaMensagem: r.ult_em ? { texto: decifrarSeguro(r.ult_texto)?.slice(0, 140) ?? (r.ult_arquivo ? '📎 Arquivo' : ''), autor: r.ult_autor, em: r.ult_em } : null,
    })),
  });
}));

// ── Perfil lateral ─────────────────────────────────────────────────────────
candidatosRouter.get('/:id', h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const u = req.usuario!;
  const c = await candidatoVisivel(u, id);
  const verObs = pode(u, 'observacoes.ver');
  const [acessoAtivo, liberacoes, acessos] = await Promise.all([
    pool.query(`SELECT l.liberado_em, l.expira_em, l.permite_arquivo, l.primeiro_uso_em, l.origem, us.nome AS liberada_por
                  FROM liberacoes_acesso l LEFT JOIN usuarios us ON us.id = l.liberada_por
                 WHERE l.candidato_id = $1 AND l.situacao = 'ativa' AND l.expira_em > now()`, [id]),
    pool.query(`SELECT l.liberado_em, l.expira_em, l.situacao, l.origem, l.motivo, l.primeiro_uso_em, us.nome AS liberada_por
                  FROM liberacoes_acesso l LEFT JOIN usuarios us ON us.id = l.liberada_por WHERE l.candidato_id = $1 ORDER BY l.liberado_em DESC LIMIT 20`, [id]),
    pool.query(`SELECT em, resultado, ip, dispositivo FROM acessos_portal WHERE candidato_id = $1 ORDER BY em DESC LIMIT 30`, [id]),
  ]);
  const [tags, etapas, statusHist, tagsHist, candidaturas, arquivos, observacoes] = await Promise.all([
    pool.query(`SELECT t.id, t.nome, t.cor FROM candidato_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.candidato_id = $1 AND t.ativa ORDER BY t.nome`, [id]),
    pool.query(`SELECT etapa, situacao, origem, atualizado_em FROM etapas_candidato WHERE candidato_id = $1`, [id]),
    pool.query(`SELECT h.em, h.autor_tipo, h.autor_nome, h.motivo, sa.nome AS anterior, sn.nome AS novo
                  FROM status_historico h LEFT JOIN status sa ON sa.id = h.status_anterior_id JOIN status sn ON sn.id = h.status_novo_id
                 WHERE h.candidato_id = $1 ORDER BY h.em DESC LIMIT 100`, [id]),
    pool.query(`SELECT h.em, h.acao, h.autor_nome, t.nome AS tag FROM tags_historico h JOIN tags t ON t.id = h.tag_id WHERE h.candidato_id = $1 ORDER BY h.em DESC LIMIT 100`, [id]),
    pool.query(`SELECT ca.recebida_em, ca.tipo, ca.nome_informado, ca.telefone_informado, ca.telefone_diferente, ca.unidade_diferente, un.nome AS unidade
                  FROM candidaturas ca JOIN unidades un ON un.id = ca.unidade_id WHERE ca.candidato_id = $1 ORDER BY ca.recebida_em DESC`, [id]),
    pool.query(`SELECT a.id, a.nome_original, a.tipo_mime, a.tamanho, ca.tipo, ca.enviado_por, ca.criado_em
                  FROM candidato_arquivos ca JOIN arquivos a ON a.id = ca.arquivo_id WHERE ca.candidato_id = $1 AND a.excluido_em IS NULL ORDER BY ca.criado_em DESC`, [id]),
    verObs
      ? pool.query(`SELECT o.id, o.texto, o.criada_em, o.autor_id, us.nome AS autor FROM observacoes o JOIN usuarios us ON us.id = o.autor_id
                     WHERE o.candidato_id = $1 AND o.excluida_em IS NULL ORDER BY o.criada_em DESC`, [id])
      : Promise.resolve({ rows: [] }),
  ]);
  await auditarReq(req, { acao: 'candidato.visualizado', resultado: 'sucesso', item: { tipo: 'candidato', id, nome: `${c.nome} ${c.sobrenome} (${c.codigo})` } });
  const telefone = decifrarSeguro(c.telefone);
  res.json({
    id: c.id, codigo: c.codigo, nome: c.nome, sobrenome: c.sobrenome,
    telefone: telefone ? formatarTelefone(telefone) : mascararTelefone(c.telefone_final),
    cpf: mascararCpf(c.cpf_final),
    unidade: { id: c.unidade_id, nome: c.unidade_nome },
    status: { id: c.status_id, nome: c.status_nome, cor: c.status_cor, final: c.status_final },
    fotoId: c.foto_id, curriculoId: c.curriculo_id, candidaturaEm: c.candidatura_em, consentimentoEm: c.consentimento_em,
    tags: tags.rows,
    etapas: ETAPAS.map((e) => etapas.rows.find((r) => r.etapa === e) ?? { etapa: e, situacao: 'nao_iniciada', origem: 'automatica' }),
    historico: {
      status: statusHist.rows,
      tags: tagsHist.rows,
      candidaturas: candidaturas.rows.map((r) => {
        const tel = decifrarSeguro(r.telefone_informado);
        return { em: r.recebida_em, tipo: r.tipo, nomeInformado: r.nome_informado, telefoneInformado: tel ? formatarTelefone(tel) : null,
          telefoneDiferente: r.telefone_diferente, unidadeDiferente: r.unidade_diferente, unidade: r.unidade };
      }),
      // Entrevistas entram aqui na etapa 6.
    },
    portal: {
      ativo: acessoAtivo.rows[0] ? {
        liberadoEm: acessoAtivo.rows[0].liberado_em, expiraEm: acessoAtivo.rows[0].expira_em, permiteArquivo: acessoAtivo.rows[0].permite_arquivo,
        primeiroUsoEm: acessoAtivo.rows[0].primeiro_uso_em, origem: acessoAtivo.rows[0].origem, liberadaPor: acessoAtivo.rows[0].liberada_por,
      } : null,
      liberacoes: liberacoes.rows.map((l) => ({ liberadoEm: l.liberado_em, expiraEm: l.expira_em, situacao: l.situacao, origem: l.origem, motivo: l.motivo, primeiroUsoEm: l.primeiro_uso_em, liberadaPor: l.liberada_por })),
      acessos: acessos.rows.map((a) => ({ em: a.em, resultado: a.resultado, ip: a.ip, dispositivo: a.dispositivo })),
    },
    arquivos: arquivos.rows.map((a) => ({ id: a.id, nome: a.nome_original, tipoMime: a.tipo_mime, tamanho: Number(a.tamanho), tipo: a.tipo, enviadoPor: a.enviado_por, em: a.criado_em })),
    observacoes: verObs ? observacoes.rows.map((o) => ({ id: o.id, texto: decifrarSeguro(o.texto), em: o.criada_em, autor: o.autor, minha: o.autor_id === u.id })) : null,
  });
}));

/** Ver o CPF completo: só para quem edita candidatos, e fica na auditoria. */
candidatosRouter.post('/:id/cpf', exigirPermissao('candidatos.editar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const c = await candidatoVisivel(req.usuario!, id);
  const cpf = decifrarSeguro(c.cpf);
  await auditarReq(req, { acao: 'candidato.cpf_visualizado', resultado: cpf ? 'sucesso' : 'falha', item: { tipo: 'candidato', id, nome: c.codigo } });
  res.json({ cpf: cpf ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : null });
}));

// ── Arquivos (currículo, foto, anexos) ─────────────────────────────────────
candidatosRouter.get('/:id/arquivos/:arquivoId', h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const arquivoId = parse(uuid, req.params.arquivoId);
  const c = await candidatoVisivel(req.usuario!, id);
  const { rows } = await pool.query(
    `SELECT a.id, a.nome_original, a.tipo_mime, a.caminho, a.sha256,
            COALESCE(ca.tipo, 'anexo') AS tipo
       FROM arquivos a
       LEFT JOIN candidato_arquivos ca ON ca.arquivo_id = a.id AND ca.candidato_id = $1
      WHERE a.id = $2 AND a.excluido_em IS NULL
        AND (ca.candidato_id IS NOT NULL OR EXISTS (
              SELECT 1 FROM mensagens m JOIN conversas cv ON cv.id = m.conversa_id WHERE m.arquivo_id = a.id AND cv.candidato_id = $1))`,
    [id, arquivoId],
  );
  const a = rows[0];
  if (!a) throw notFound('Arquivo não encontrado.');
  const baixar = req.query.baixar === '1';
  const miniatura = a.tipo === 'foto' && req.query.miniatura === '1';
  // A foto em miniatura (lista e perfil) só exige ver candidatos; currículo e anexos exigem a permissão própria.
  if (!miniatura && a.tipo !== 'foto' && !pode(req.usuario, 'candidatos.curriculo.baixar')) throw forbidden();
  const conteudo = await lerArquivo(a.caminho, a.sha256);
  if (!miniatura) {
    await auditarReq(req, { acao: baixar ? 'documento.baixado' : 'documento.visualizado', resultado: 'sucesso', item: { tipo: a.tipo, id: a.id, nome: `${a.nome_original} · ${c.codigo}` } });
  }
  res.setHeader('Content-Type', a.tipo_mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${baixar ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.nome_original)}`);
  res.send(conteudo);
}));

// ── Editar dados ───────────────────────────────────────────────────────────
candidatosRouter.put('/:id', exigirPermissao('candidatos.editar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({
    nome: z.string().trim().max(80).refine(nomeValido, 'Nome inválido.'),
    sobrenome: z.string().trim().max(120).refine(nomeValido, 'Sobrenome inválido.'),
    telefone: z.string().max(30),
    unidadeId: uuid,
  }), req.body);
  const telefone = normalizarTelefone(body.telefone);
  if (!telefone) throw badRequest('Telefone inválido. Informe DDD e número.');
  if (!enxergaUnidade(req.usuario!, body.unidadeId)) throw forbidden('Você não tem acesso a esta unidade.');
  await transaction(async (db) => {
    const c = await candidatoVisivel(req.usuario!, id, db, true);
    const un = await db.query('SELECT 1 FROM unidades WHERE id = $1 AND excluido_em IS NULL', [body.unidadeId]);
    if (!un.rowCount) throw badRequest('Unidade não encontrada.');
    const nome = capitalizarNome(body.nome);
    const sobrenome = capitalizarNome(body.sobrenome);
    const telHash = hmac(`tel:${telefone}`);
    const alterados = [nome !== c.nome && 'nome', sobrenome !== c.sobrenome && 'sobrenome', telHash !== c.telefone_hash && 'telefone', body.unidadeId !== c.unidade_id && 'unidade'].filter(Boolean);
    if (!alterados.length) return;
    await db.query(
      `UPDATE candidatos SET nome = $2, sobrenome = $3, telefone = $4, telefone_hash = $5, telefone_final = $6, unidade_id = $7, atualizado_em = now() WHERE id = $1`,
      [id, nome, sobrenome, encrypt(telefone), telHash, telefone.slice(-4), body.unidadeId],
    );
    await auditarReq(req, { acao: 'candidato.alterado', resultado: 'sucesso', item: { tipo: 'candidato', id, nome: c.codigo }, detalhes: { campos: alterados } }, db);
    await avisarMudanca(db, id, body.unidadeId);
    if (body.unidadeId !== c.unidade_id) await avisarMudanca(db, id, c.unidade_id); // some da lista da unidade antiga
  });
  res.json({ ok: true });
}));

// ── Status ─────────────────────────────────────────────────────────────────
candidatosRouter.post('/:id/status', exigirPermissao('status.alterar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({ statusId: uuid, motivo: z.string().trim().max(255).optional() }), req.body);
  await transaction(async (db) => {
    const c = await candidatoVisivel(req.usuario!, id, db, true);
    if (c.status_id === body.statusId) return;
    const s = await db.query<{ nome: string }>('SELECT nome FROM status WHERE id = $1 AND ativo', [body.statusId]);
    if (!s.rowCount) throw badRequest('Status não encontrado.');
    await db.query('UPDATE candidatos SET status_id = $2 WHERE id = $1', [id, body.statusId]);
    const a = autor(req);
    await db.query(
      `INSERT INTO status_historico (candidato_id, status_anterior_id, status_novo_id, autor_tipo, autor_usuario_id, autor_nome, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, c.status_id, body.statusId, a.tipo, a.id, a.nome, body.motivo ?? null],
    );
    await recalcularLinhaDoTempo(db, id, body.statusId);
    await registrarEvento(db, 'candidato.status_alterado', id, { de: c.status_id, para: body.statusId, autor: a });
    await auditarReq(req, { acao: 'candidato.status_alterado', resultado: 'sucesso', item: { tipo: 'candidato', id, nome: c.codigo }, detalhes: { de: c.status_nome, para: s.rows[0].nome, motivo: body.motivo } }, db);
    await avisarMudanca(db, id, c.unidade_id);
  });
  res.json({ ok: true });
}));

// ── Tags ───────────────────────────────────────────────────────────────────
for (const acao of ['adicionar', 'remover'] as const) {
  candidatosRouter.post(`/:id/tags/${acao}`, exigirPermissao('status.alterar'), h(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { tagId } = parse(z.object({ tagId: uuid }), req.body);
    await transaction(async (db) => {
      const c = await candidatoVisivel(req.usuario!, id, db, true);
      const t = await db.query<{ nome: string }>('SELECT nome FROM tags WHERE id = $1 AND ativa', [tagId]);
      if (!t.rowCount) throw badRequest('Tag não encontrada.');
      const r = acao === 'adicionar'
        ? await db.query('INSERT INTO candidato_tags (candidato_id, tag_id, adicionada_por) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, tagId, req.usuario!.id])
        : await db.query('DELETE FROM candidato_tags WHERE candidato_id = $1 AND tag_id = $2', [id, tagId]);
      if (!r.rowCount) return; // já estava assim
      const a = autor(req);
      await db.query(
        `INSERT INTO tags_historico (candidato_id, tag_id, acao, autor_tipo, autor_usuario_id, autor_nome) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, tagId, acao === 'adicionar' ? 'adicionada' : 'removida', a.tipo, a.id, a.nome],
      );
      await registrarEvento(db, acao === 'adicionar' ? 'candidato.tag_adicionada' : 'candidato.tag_removida', id, { tagId, autor: a });
      await auditarReq(req, { acao: acao === 'adicionar' ? 'candidato.tag_adicionada' : 'candidato.tag_removida', resultado: 'sucesso', item: { tipo: 'candidato', id, nome: c.codigo }, detalhes: { tag: t.rows[0].nome } }, db);
      await avisarMudanca(db, id, c.unidade_id);
    });
    res.json({ ok: true });
  }));
}

// ── Linha do tempo: ajuste manual ──────────────────────────────────────────
candidatosRouter.put('/:id/etapas/:etapa', exigirPermissao('status.alterar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const etapa = parse(z.enum(ETAPAS), req.params.etapa);
  const { situacao } = parse(z.object({ situacao: z.enum(['concluida', 'em_andamento', 'aguardando', 'nao_iniciada']) }), req.body);
  await transaction(async (db) => {
    const c = await candidatoVisivel(req.usuario!, id, db, true);
    await db.query(
      `INSERT INTO etapas_candidato (candidato_id, etapa, situacao, origem, atualizado_por) VALUES ($1, $2, $3, 'manual', $4)
       ON CONFLICT (candidato_id, etapa) DO UPDATE SET situacao = EXCLUDED.situacao, origem = 'manual', atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
      [id, etapa, situacao, req.usuario!.id],
    );
    await auditarReq(req, { acao: 'candidato.etapa_ajustada', resultado: 'sucesso', item: { tipo: 'candidato', id, nome: c.codigo }, detalhes: { etapa, situacao } }, db);
    await avisarMudanca(db, id, c.unidade_id);
  });
  res.json({ ok: true });
}));

// ── Observações internas (nunca vão para o portal) ─────────────────────────
candidatosRouter.post('/:id/observacoes', exigirPermissao('observacoes.ver'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { texto } = parse(z.object({ texto: z.string().trim().min(1, 'Escreva a observação.').max(4000) }), req.body);
  await transaction(async (db) => {
    const c = await candidatoVisivel(req.usuario!, id, db);
    await db.query('INSERT INTO observacoes (candidato_id, texto, autor_id) VALUES ($1, $2, $3)', [id, encrypt(texto), req.usuario!.id]);
    await auditarReq(req, { acao: 'candidato.observacao_criada', resultado: 'sucesso', item: { tipo: 'candidato', id, nome: c.codigo } }, db);
  });
  res.status(201).json({ ok: true });
}));

candidatosRouter.delete('/:id/observacoes/:obsId', exigirPermissao('observacoes.ver'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const obsId = parse(uuid, req.params.obsId);
  const c = await candidatoVisivel(req.usuario!, id);
  // Cada pessoa exclui só as próprias observações.
  const r = await pool.query('UPDATE observacoes SET excluida_em = now() WHERE id = $1 AND candidato_id = $2 AND autor_id = $3 AND excluida_em IS NULL', [obsId, id, req.usuario!.id]);
  if (!r.rowCount) throw notFound('Observação não encontrada (ou não é sua).');
  await auditarReq(req, { acao: 'candidato.observacao_excluida', resultado: 'sucesso', item: { tipo: 'candidato', id, nome: c.codigo } });
  res.json({ ok: true });
}));

// ── Portal: liberar e revogar o acesso do dia ──────────────────────────────
/**
 * Liberação manual pela gestora. Gera o código do dia (vale até 23:59:59 em Brasília) e devolve o código
 * UMA ÚNICA VEZ, para ser enviado ao candidato. A partir da etapa 7 o envio é feito pelo WhatsApp
 * (e na etapa 8, pelas automações), usando esta mesma função de liberação.
 */
candidatosRouter.post('/:id/acesso', exigirPermissao('portal.liberar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { permiteArquivo } = parse(z.object({ permiteArquivo: z.boolean().default(false) }), req.body);
  const r = await transaction(async (db) => {
    const c = await candidatoVisivel(req.usuario!, id, db, true);
    const ator = { usuarioId: req.usuario!.id, usuarioNome: req.usuario!.nome, perfil: req.usuario!.perfilNome, setor: req.usuario!.setor };
    const lib = await liberarAcesso(db, id, c.unidade_id, { tipo: 'usuario', usuarioId: req.usuario!.id, ator }, { permiteArquivo }, ipDe(req));
    return { ...lib, nome: c.nome };
  });
  const link = `${env.APP_URL.replace(/\/$/, '')}/acesso`;
  res.status(201).json({
    codigo: r.codigo,
    expiraEm: r.expiraEm,
    link,
    mensagemSugerida: `Olá, ${r.nome}! Para acompanhar sua candidatura na Hummm! Pizzas, acesse ${link} e use o código ${r.codigo}. Ele vale até as 23h59 de hoje.`,
    aviso: 'O código aparece só agora. Ele não fica guardado no sistema.',
  });
}));

candidatosRouter.post('/:id/acesso/revogar', exigirPermissao('portal.liberar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const revogou = await transaction(async (db) => {
    const c = await candidatoVisivel(req.usuario!, id, db, true);
    const ator = { usuarioId: req.usuario!.id, usuarioNome: req.usuario!.nome, perfil: req.usuario!.perfilNome, setor: req.usuario!.setor };
    return revogarAcesso(db, id, c.unidade_id, { tipo: 'usuario', usuarioId: req.usuario!.id, ator }, 'Revogada pela equipe de RH', ipDe(req));
  });
  if (!revogou) throw notFound('Não há acesso ativo para revogar.');
  res.json({ ok: true });
}));
