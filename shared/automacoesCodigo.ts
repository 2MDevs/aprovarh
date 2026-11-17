/**
 * Código das automações (decisão D46): pedir um fluxo para uma IA e colar o código de volta no construtor.
 * - montarPedidoParaIA: texto com o catálogo de cards, o formato e as regras, para copiar e colar numa IA.
 * - lerCodigo: confere o código colado e devolve um fluxo pronto para o construtor (ou os erros, em português).
 * O código só usa cards que já existem: um gatilho, condição ou ação novo precisa ser programado pela TI.
 */
import { CARD, CARDS, CATEGORIAS, LIMITES, VARIAVEIS, organizar, type Fluxo, type No, type Ligacao, type Parametro } from './automacoes';

export interface ItemOpcao { id: string; nome: string }
export interface OpcoesCodigo { status: ItemOpcao[]; tags: ItemOpcao[]; unidades: ItemOpcao[] }

const FORMATO_VALOR: Record<string, string> = {
  texto: 'texto',
  textoLongo: 'texto (pode ter quebras de linha)',
  numero: 'número',
  hora: 'texto "HH:MM" (horário de Brasília)',
  data: 'texto "AAAA-MM-DD"',
  booleano: 'true ou false',
  selecao: 'um dos valores listados',
  status: 'id de um status (lista abaixo)',
  statusVarios: 'lista de ids de status (lista abaixo)',
  tag: 'id de uma tag (lista abaixo)',
  unidades: 'lista de ids de unidades (lista abaixo)',
  diasSemana: 'lista de números (0 = domingo ... 6 = sábado)',
  no: 'id de outro card deste fluxo (um card anterior)',
};

function descreverParametro(p: Parametro): string {
  const partes = [`"${p.chave}" (${p.rotulo}): ${FORMATO_VALOR[p.tipo] ?? p.tipo}`];
  if (p.obrigatorio) partes.push('obrigatório');
  if (p.opcoes) partes.push(`valores: ${p.opcoes.map((o) => `"${o.valor}" = ${o.rotulo}`).join('; ')}`);
  if (p.min !== undefined || p.max !== undefined) partes.push(`de ${p.min ?? '...'} a ${p.max ?? '...'}`);
  if (p.padrao !== undefined) partes.push(`padrão ${JSON.stringify(p.padrao)}`);
  if (p.variaveis) partes.push('aceita variáveis');
  return partes.join(', ');
}

export function montarPedidoParaIA(pedido: string, opcoes: OpcoesCodigo, fluxoAtual?: Fluxo | null): string {
  const catalogo = (Object.keys(CATEGORIAS) as (keyof typeof CATEGORIAS)[]).map((cat) => {
    const cards = CARDS.filter((c) => c.categoria === cat).map((c) => {
      const linhas = [`- tipo "${c.tipo}" — ${c.nome}: ${c.descricao}`];
      linhas.push(`  saídas: ${c.saidas.map((s) => `"${s.id}"${s.rotulo ? ` (${s.rotulo})` : ''}`).join(', ')}`);
      if (c.parametros.length) for (const p of c.parametros) linhas.push(`  parâmetro ${descreverParametro(p)}`);
      if (c.requer?.length) linhas.push(`  precisa antes: ${c.requer.join(', ')}`);
      if (c.produz?.length) linhas.push(`  fornece: ${c.produz.join(', ')}`);
      if (c.produzNaSaida) linhas.push(`  fornece na saída: ${Object.entries(c.produzNaSaida).map(([s, d]) => `${s} → ${d.join(', ')}`).join('; ')}`);
      return linhas.join('\n');
    });
    return `### ${CATEGORIAS[cat]}\n${cards.join('\n')}`;
  }).join('\n\n');

  const lista = (titulo: string, itens: ItemOpcao[]) => `${titulo}:\n${itens.length ? itens.map((i) => `- "${i.id}" = ${i.nome}`).join('\n') : '- (nenhum cadastrado)'}`;
  const variaveis = Object.entries(VARIAVEIS).map(([k, v]) => `{${k}} = ${v.rotulo}${v.requer ? ` (precisa de ${v.requer} antes)` : ''}`).join('; ');

  return `Você vai montar uma automação para o aprovaRH, a plataforma de recrutamento da Hummm! Pizzas.
Responda SOMENTE com um bloco de código JSON, sem explicações fora dele.

## O que eu quero
${pedido.trim() || '(descreva aqui a automação que você quer)'}

## Formato do JSON
{
  "nome": "Nome curto da automação",
  "nos": [ { "id": "texto_curto", "tipo": "tipo do card", "nome": "Nome que aparece no card (opcional)", "params": { ... } } ],
  "ligacoes": [ { "de": "id do card de origem", "saida": "id da saída", "para": "id do card de destino" } ]
}

## Regras
1. Use SOMENTE os tipos de card do catálogo abaixo. Não invente tipos, saídas nem parâmetros.
2. Exatamente um card de Gatilho, e ele é o começo do fluxo. Nada liga para o gatilho.
3. Cada saída de um card liga em no máximo um card. Um card pode receber várias ligações.
4. Todo card (menos o gatilho) precisa ser alcançado a partir do gatilho.
5. "id" dos cards: letras minúsculas, números e _ (até 40 caracteres), sem repetir.
6. Status, tags e unidades: use os ids das listas abaixo. Se faltar uma tag ou status, diga no campo "nome" da automação que precisa ser criado.
7. Textos de mensagem podem usar as variáveis: ${variaveis}.
8. No máximo ${LIMITES.nos} cards. Mensagens com até ${LIMITES.textoMax} caracteres.
9. Se o que eu pedi precisar de um gatilho, condição ou ação que NÃO existe no catálogo, não invente: responda só com {"faltando": ["descrição de cada card que precisaria existir"]}.

## Catálogo de cards
${catalogo}

## Cadastros
${lista('Status', opcoes.status)}

${lista('Tags', opcoes.tags)}

${lista('Unidades', opcoes.unidades)}
${fluxoAtual && fluxoAtual.nos.length ? `\n## Fluxo atual (para alterar, se for o caso)\n\`\`\`json\n${exportarCodigo(fluxoAtual)}\n\`\`\`\n` : ''}`;
}

/** Fluxo atual em código (sem posições), para copiar ou mandar para a IA. */
export function exportarCodigo(f: Fluxo, nome?: string): string {
  return JSON.stringify({
    ...(nome ? { nome } : {}),
    nos: f.nos.map((n) => ({ id: n.id, tipo: n.tipo, ...(n.nome ? { nome: n.nome } : {}), params: n.params })),
    ligacoes: f.ligacoes.map((l) => ({ de: l.de, saida: l.saida, para: l.para })),
  }, null, 2);
}

export type LeituraCodigo =
  | { ok: true; fluxo: Fluxo; nome: string | null }
  | { ok: false; erros: string[]; faltando?: string[] };

/** Tira o JSON de dentro da resposta da IA (aceita bloco ```json ... ``` ou o JSON puro). */
function extrairJson(texto: string): unknown {
  const bloco = texto.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? texto;
  const inicio = bloco.indexOf('{');
  const fim = bloco.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) throw new Error('vazio');
  return JSON.parse(bloco.slice(inicio, fim + 1));
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,40}$/;

export function lerCodigo(texto: string): LeituraCodigo {
  let bruto: unknown;
  try {
    bruto = extrairJson(texto);
  } catch {
    return { ok: false, erros: ['Não encontrei um código válido. Cole a resposta da IA inteira (o bloco que começa com { e termina com }).'] };
  }
  const obj = bruto as { nome?: unknown; nos?: unknown; ligacoes?: unknown; faltando?: unknown };
  if (Array.isArray(obj.faltando)) {
    return { ok: false, erros: ['A IA respondeu que faltam cards para fazer essa automação. Peça à TI para criá-los.'], faltando: obj.faltando.map(String).slice(0, 20) };
  }
  if (!Array.isArray(obj.nos) || !Array.isArray(obj.ligacoes)) return { ok: false, erros: ['O código precisa ter as listas "nos" e "ligacoes".'] };
  if (obj.nos.length > LIMITES.nos) return { ok: false, erros: [`O código tem ${obj.nos.length} cards; o máximo é ${LIMITES.nos}.`] };

  const erros: string[] = [];
  const nos: No[] = [];
  const ids = new Set<string>();
  let semPosicao = false;
  for (const [i, x] of (obj.nos as Record<string, unknown>[]).entries()) {
    const id = String(x?.id ?? '');
    const tipo = String(x?.tipo ?? '');
    const def = CARD[tipo];
    if (!ID_VALIDO.test(id)) { erros.push(`Card ${i + 1}: "id" inválido (use letras, números e _, até 40).`); continue; }
    if (ids.has(id)) { erros.push(`Card "${id}": id repetido.`); continue; }
    if (!def) { erros.push(`Card "${id}": o tipo "${tipo}" não existe no aprovaRH.`); continue; }
    ids.add(id);
    const recebidos = (x.params && typeof x.params === 'object' && !Array.isArray(x.params) ? x.params : {}) as Record<string, unknown>;
    const params: Record<string, unknown> = {};
    for (const p of def.parametros) {
      if (recebidos[p.chave] !== undefined) params[p.chave] = recebidos[p.chave];
      else if (p.padrao !== undefined) params[p.chave] = p.padrao;
    }
    const sobrando = Object.keys(recebidos).filter((k) => !def.parametros.some((p) => p.chave === k));
    if (sobrando.length) erros.push(`Card "${id}": parâmetro(s) que não existem em "${def.nome}": ${sobrando.join(', ')}.`);
    const pos = x.posicao as { x?: unknown; y?: unknown } | undefined;
    const temPos = pos && Number.isFinite(Number(pos.x)) && Number.isFinite(Number(pos.y));
    if (!temPos) semPosicao = true;
    const nome = typeof x.nome === 'string' && x.nome.trim() ? x.nome.trim().slice(0, 80) : undefined;
    nos.push({ id, tipo, params, posicao: temPos ? { x: Number(pos!.x), y: Number(pos!.y) } : { x: 0, y: 0 }, ...(nome ? { nome } : {}) });
  }

  const ligacoes: Ligacao[] = [];
  const porId = new Map(nos.map((n) => [n.id, n]));
  for (const [i, l] of (obj.ligacoes as Record<string, unknown>[]).entries()) {
    const de = porId.get(String(l?.de ?? ''));
    const para = porId.get(String(l?.para ?? ''));
    const saida = String(l?.saida ?? '');
    if (!de || !para) { erros.push(`Ligação ${i + 1}: liga um card que não existe ("${String(l?.de)}" → "${String(l?.para)}").`); continue; }
    if (!CARD[de.tipo].saidas.some((s) => s.id === saida)) {
      erros.push(`Ligação ${i + 1}: "${de.id}" não tem a saída "${saida}" (saídas: ${CARD[de.tipo].saidas.map((s) => s.id).join(', ')}).`);
      continue;
    }
    ligacoes.push({ id: `l_${de.id}_${saida}`.slice(0, 100), de: de.id, saida, para: para.id });
  }
  if (erros.length) return { ok: false, erros: erros.slice(0, 15) };
  const fluxo: Fluxo = { nos, ligacoes };
  return { ok: true, fluxo: semPosicao ? organizar(fluxo) : fluxo, nome: typeof obj.nome === 'string' && obj.nome.trim() ? obj.nome.trim().slice(0, 120) : null };
}
