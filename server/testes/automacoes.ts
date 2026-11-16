/**
 * Testes do motor de automações sem banco: validação do fluxo e o fluxo de referência
 * percorrido pelo mesmo código do motor, com efeitos de teste (nada é enviado).
 * Rodar: npm run test:automacoes
 */
import assert from 'node:assert/strict';
import { fluxoDeReferencia, validarFluxo, type Fluxo } from '../../shared/automacoes.ts';
import { instanteEmBrasilia } from '../lib/datas.ts';
import { NAO_PADRAO, SIM_PADRAO } from '../lib/interpretar.ts';
import { efeitosDeTeste, simular, type CandidatoAtual } from '../modules/automacoes/cards.ts';

let ok = 0;
async function teste(nome: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    ok++;
    console.log(`✓ ${nome}`);
  } catch (err) {
    console.error(`✗ ${nome}\n  ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

const no = (id: string, tipo: string, params: Record<string, unknown> = {}) => ({ id, tipo, params, posicao: { x: 0, y: 0 } });
const liga = (de: string, saida: string, para: string) => ({ id: `${de}-${saida}`, de, saida, para });
const erros = (f: Fluxo, ctx = {}) => validarFluxo(f, ctx).filter((p) => !p.aviso).map((p) => p.mensagem);

// ── Validação ──
await teste('fluxo vazio é recusado', () => assert.ok(erros({ nos: [], ligacoes: [] }).length));
await teste('sem gatilho é recusado', () => assert.ok(erros({ nos: [no('a', 'acao.chat_mensagem', { texto: 'oi' })], ligacoes: [] }).some((m) => m.includes('gatilho'))));
await teste('dois gatilhos são recusados', () => assert.ok(erros({ nos: [no('g', 'gatilho.acesso_expirado'), no('h', 'gatilho.acesso_liberado')], ligacoes: [] }).some((m) => m.includes('um gatilho'))));
await teste('ciclo é recusado', () => {
  const f = { nos: [no('g', 'gatilho.acesso_expirado'), no('a', 'acao.chat_mensagem', { texto: 'a' }), no('b', 'acao.chat_mensagem', { texto: 'b' })], ligacoes: [liga('g', 'proximo', 'a'), liga('a', 'proximo', 'b'), liga('b', 'proximo', 'a')] };
  assert.ok(erros(f).some((m) => m.includes('ciclo')));
});
await teste('card solto é recusado', () => {
  const f = { nos: [no('g', 'gatilho.acesso_expirado'), no('a', 'acao.chat_mensagem', { texto: 'a' }), no('b', 'acao.chat_mensagem', { texto: 'b' })], ligacoes: [liga('g', 'proximo', 'a')] };
  assert.ok(erros(f).some((m) => m.includes('solto')));
});
await teste('saída inexistente é recusada', () => {
  const f = { nos: [no('g', 'gatilho.acesso_expirado'), no('a', 'acao.chat_mensagem', { texto: 'a' })], ligacoes: [liga('g', 'sim', 'a')] };
  assert.ok(erros(f).some((m) => m.includes('não existe neste card')));
});
await teste('verificar SIM/NÃO sem resposta antes é recusado', () => {
  const f = { nos: [no('g', 'gatilho.status_alterado'), no('c', 'condicao.resposta_sim_nao')], ligacoes: [liga('g', 'proximo', 'c')] };
  assert.ok(erros(f).some((m) => m.includes('resposta do candidato')));
});
await teste('enviar link sem gerar código é recusado', () => {
  const f = { nos: [no('g', 'gatilho.acesso_expirado'), no('l', 'acao.enviar_link')], ligacoes: [liga('g', 'proximo', 'l')] };
  assert.ok(erros(f).some((m) => m.includes('código gerado')));
});
await teste('variável desconhecida é recusada', () => {
  const f = { nos: [no('g', 'gatilho.acesso_expirado'), no('a', 'acao.chat_mensagem', { texto: 'Oi {apelido}' })], ligacoes: [liga('g', 'proximo', 'a')] };
  assert.ok(erros(f).some((m) => m.includes('{apelido}')));
});
await teste('WhatsApp não configurado bloqueia cards que enviam', () => {
  const f = { nos: [no('g', 'gatilho.acesso_expirado'), no('a', 'acao.whatsapp_mensagem', { texto: 'oi' })], ligacoes: [liga('g', 'proximo', 'a')] };
  assert.ok(erros(f, { whatsappConfigurado: false }).some((m) => m.includes('WhatsApp')));
});
await teste('repetir só volta para card anterior', () => {
  const f = { nos: [no('g', 'gatilho.acesso_expirado'), no('a', 'acao.chat_mensagem', { texto: 'a' }), no('r', 'tempo.repetir', { alvo: 'x', limite: 2 }), no('x', 'acao.chat_mensagem', { texto: 'x' })],
    ligacoes: [liga('g', 'proximo', 'a'), liga('a', 'proximo', 'r'), liga('r', 'esgotou', 'x')] };
  assert.ok(erros(f).some((m) => m.includes('vem antes')));
});
await teste('fluxo de referência só pede status e tag', () => {
  const e = erros(fluxoDeReferencia(), { whatsappConfigurado: true, statusIds: [], tagIds: [] });
  assert.equal(e.length, 2, e.join(' | '));
});

// ── Fluxo de referência percorrido ──
const f = fluxoDeReferencia();
for (const n of f.nos) {
  if (n.id === 'sim_status') n.params.status = 'aprovado';
  if (n.id === 'sim_tag') n.params.tag = 'confirmou';
}
await teste('fluxo de referência preenchido passa na validação', () => assert.deepEqual(erros(f, { whatsappConfigurado: true }), []));

const agora = instanteEmBrasilia('2026-11-16', '08:00');
const vagas = [{ data: '2026-11-18', hora: '10:00', livres: 0 }, { data: '2026-11-18', hora: '14:00', livres: 1 }, { data: '2026-11-20', hora: '09:00', livres: 1 }];
const leitura = {
  horarios: async (de: string, ate: string) => vagas.filter((h) => h.data >= de && h.data <= ate).map((h) => ({ ...h, inicioEm: instanteEmBrasilia(h.data, h.hora).toISOString() })),
  nomeStatus: async (id: string) => id,
  nomeTag: async (id: string) => id,
};
const candidato = (): CandidatoAtual => ({
  id: 'c', nome: 'Ana', unidadeId: 'u', unidadeNome: 'Centro', statusId: 'novo', tagIds: [], acessoAtivo: false,
  entrevista: { id: 'e', situacao: 'aguardando_confirmacao', inicioEm: instanteEmBrasilia('2026-11-16', '15:00').toISOString() },
});
async function rodar(respostas: string[]) {
  const cand = candidato();
  const r = await simular(f, cand, { evento: { tipo: 'teste', dados: {} } }, efeitosDeTeste(cand, leitura, { janelaAberta: true, provedor: 'evolution' }), { sim: SIM_PADRAO, nao: NAO_PADRAO, link: 'https://x/acesso', agora }, respostas);
  return { cand, caminho: r.passos.map((p) => p.noId), fim: r.fim };
}

await teste('SIM confirma, muda status e tag e avisa a gestora', async () => {
  const r = await rodar(['sim']);
  assert.equal(r.cand.entrevista?.situacao, 'confirmada');
  assert.equal(r.cand.statusId, 'aprovado');
  assert.deepEqual(r.cand.tagIds, ['confirmou']);
  assert.equal(r.caminho.at(-1), 'sim_avisar');
});
await teste('NÃO + data com vaga remarca e pede nova confirmação', async () => {
  const r = await rodar(['não posso', 'dia 18 às 14h']);
  assert.equal(r.cand.entrevista?.inicioEm, instanteEmBrasilia('2026-11-18', '14:00').toISOString());
  assert.ok(r.caminho.includes('nao_confirmar'));
});
await teste('NÃO + horário lotado pede outra data e aceita a segunda', async () => {
  const r = await rodar(['nao', 'dia 18 às 10', '20/11']);
  assert.ok(r.caminho.includes('outra_repetir'));
  assert.equal(r.cand.entrevista?.inicioEm, instanteEmBrasilia('2026-11-20', '09:00').toISOString());
});
await teste('nunca acerta a data: para no limite e chama a equipe', async () => {
  const r = await rodar(['nao', 'talvez', 'sei lá', 'hmm']);
  assert.equal(r.caminho.filter((id) => id === 'outra_repetir').length, 3);
  assert.equal(r.caminho.at(-1), 'outra_avisar');
});
await teste('sem resposta segue por "Tempo esgotado"', async () => {
  const r = await rodar([]);
  assert.equal(r.caminho.at(-1), 'sem_resposta');
});
await teste('resposta confusa avisa a gestora', async () => {
  const r = await rodar(['talvez']);
  assert.equal(r.caminho.at(-1), 'duvida');
});

console.log(`\n${ok} teste(s) passaram.`);
