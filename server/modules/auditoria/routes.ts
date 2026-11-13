import { Router } from 'express';
import { z } from 'zod';
import { auditarReq, verificarCorrente } from '../../core/audit.ts';
import { pool } from '../../db/pool.ts';
import { h, parse } from '../../lib/http.ts';
import { exigirLogin, exigirPermissao } from '../../middleware/auth.ts';

/** Auditoria: só leitura, com filtros, busca e exportação CSV. Ninguém edita nem apaga pela tela (nem pelo banco). */
export const auditoriaRouter = Router();
auditoriaRouter.use(exigirLogin(), exigirPermissao('auditoria.ver'));

const filtros = z.object({
  de: z.string().datetime({ offset: true }).optional(),
  ate: z.string().datetime({ offset: true }).optional(),
  usuarioId: z.string().uuid().optional(),
  setor: z.string().max(80).optional(),
  acao: z.string().max(80).optional(),
  resultado: z.enum(['sucesso', 'negado', 'bloqueado', 'falha']).optional(),
  busca: z.string().trim().max(120).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(10).max(200).default(50),
});

function montarWhere(f: z.infer<typeof filtros>) {
  const cond: string[] = [];
  const p: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    p.push(v);
    cond.push(sql.replace('?', `$${p.length}`));
  };
  if (f.de) add('em >= ?', f.de);
  if (f.ate) add('em <= ?', f.ate);
  if (f.usuarioId) add('usuario_id = ?', f.usuarioId);
  if (f.setor) add('setor = ?', f.setor);
  if (f.acao) add('acao LIKE ?', `${f.acao.replace(/[%_]/g, '')}%`);
  if (f.resultado) add('resultado = ?', f.resultado);
  if (f.busca) {
    p.push(`%${f.busca.replace(/[%_]/g, '')}%`);
    const i = `$${p.length}`;
    cond.push(`(usuario_nome ILIKE ${i} OR item_nome ILIKE ${i} OR acao ILIKE ${i} OR ip ILIKE ${i} OR chave_api_nome ILIKE ${i})`);
  }
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params: p };
}

const COLUNAS = `id, em, usuario_id, usuario_nome, perfil, setor, chave_api_nome, acao, item_tipo, item_id, item_nome,
  detalhes, resultado, ip, dispositivo, hash`;

auditoriaRouter.get('/', h(async (req, res) => {
  const f = parse(filtros, req.query);
  const { where, params } = montarWhere(f);
  const [lista, total] = await Promise.all([
    pool.query(`SELECT ${COLUNAS} FROM auditoria ${where} ORDER BY id DESC LIMIT ${f.porPagina} OFFSET ${(f.pagina - 1) * f.porPagina}`, params),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM auditoria ${where}`, params),
  ]);
  res.json({
    total: total.rows[0].n,
    pagina: f.pagina,
    porPagina: f.porPagina,
    registros: lista.rows.map((r) => ({
      id: Number(r.id), em: r.em, pessoa: r.chave_api_nome ? `${r.usuario_nome} (API: ${r.chave_api_nome})` : r.usuario_nome,
      usuarioId: r.usuario_id, perfil: r.perfil, setor: r.setor, acao: r.acao,
      item: r.item_tipo ? { tipo: r.item_tipo, id: r.item_id, nome: r.item_nome } : null,
      detalhes: r.detalhes, resultado: r.resultado, ip: r.ip, dispositivo: r.dispositivo, hash: r.hash,
    })),
  });
}));

auditoriaRouter.get('/exportar.csv', h(async (req, res) => {
  const f = parse(filtros, req.query);
  const { where, params } = montarWhere(f);
  const { rows } = await pool.query(`SELECT ${COLUNAS} FROM auditoria ${where} ORDER BY id DESC LIMIT 100000`, params);
  const csv = (v: unknown) => {
    let s = v === null || v === undefined ? '' : typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita fórmulas ao abrir no Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  const cab = ['id', 'data_hora', 'pessoa', 'perfil', 'setor', 'chave_api', 'acao', 'item_tipo', 'item_id', 'item_nome', 'detalhes', 'resultado', 'ip', 'dispositivo', 'hash'];
  const linhas = rows.map((r) => [r.id, r.em, r.usuario_nome, r.perfil, r.setor, r.chave_api_nome, r.acao, r.item_tipo, r.item_id, r.item_nome, r.detalhes, r.resultado, r.ip, r.dispositivo, r.hash].map(csv).join(';'));
  await auditarReq(req, { acao: 'auditoria.exportada', resultado: 'sucesso', detalhes: { registros: rows.length, filtros: { ...f, pagina: undefined, porPagina: undefined } } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="auditoria-aprovarh-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + [cab.join(';'), ...linhas].join('\r\n'));
}));

/** Confere o encadeamento SHA-256 de todos os registros. */
auditoriaRouter.get('/verificar', h(async (req, res) => {
  const r = await verificarCorrente();
  await auditarReq(req, { acao: 'auditoria.verificada', resultado: r.ok ? 'sucesso' : 'falha', detalhes: r });
  res.json(r);
}));

/** Opções para os filtros da tela. */
auditoriaRouter.get('/opcoes', h(async (_req, res) => {
  const [acoes, setores, pessoas] = await Promise.all([
    pool.query<{ acao: string }>('SELECT DISTINCT acao FROM auditoria ORDER BY acao'),
    pool.query<{ setor: string }>('SELECT DISTINCT setor FROM auditoria WHERE setor IS NOT NULL ORDER BY setor'),
    pool.query<{ id: string; nome: string }>('SELECT id, nome FROM usuarios ORDER BY nome'),
  ]);
  res.json({ acoes: acoes.rows.map((r) => r.acao), setores: setores.rows.map((r) => r.setor), pessoas: pessoas.rows });
}));
