/**
 * Interpretação das respostas do candidato pelo WhatsApp, sem IA:
 * - SIM / NÃO (palavras aceitas configuráveis);
 * - data (e horário, se vier) dentro de um período.
 * O que não for claro volta como "ambíguo", e o sistema pede esclarecimento. Nunca chuta.
 */

export function normalizarTexto(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}:/\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export const SIM_PADRAO = ['sim', 's', 'confirmo', 'confirmado', 'pode ser', 'ok', 'certo', 'estarei', 'vou sim', 'claro'];
export const NAO_PADRAO = ['nao', 'n', 'nao posso', 'nao vou', 'nao consigo', 'outro dia', 'outra data'];

/** SIM, NÃO ou ambíguo. Precisa bater com a lista inteira (não basta conter a palavra). */
export function interpretarSimNao(texto: string, sim = SIM_PADRAO, nao = NAO_PADRAO): 'sim' | 'nao' | 'ambiguo' {
  const t = normalizarTexto(texto).replace(/[!.,?]+/g, '').trim();
  const lista = (xs: string[]) => xs.map(normalizarTexto);
  const ehSim = lista(sim).includes(t);
  const ehNao = lista(nao).includes(t);
  if (ehSim === ehNao) return 'ambiguo';
  return ehSim ? 'sim' : 'nao';
}

const DIAS: Record<string, number> = {
  domingo: 0, segunda: 1, 'segunda feira': 1, terca: 2, 'terca feira': 2, quarta: 3, 'quarta feira': 3,
  quinta: 4, 'quinta feira': 4, sexta: 5, 'sexta feira': 5, sabado: 6,
};
const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function valida(a: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const somar = (data: string, n: number) => new Date(Date.parse(`${data}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface DataInterpretada { tipo: 'data'; datas: string[]; hora: string | null }
export type ResultadoData = DataInterpretada | { tipo: 'ambiguo'; motivo: string };

/**
 * Lê a data que o candidato escreveu. `hoje` e o período [de, ate] em YYYY-MM-DD (Brasília).
 * Aceita: 20/11, 20/11/2026, 20-11, "dia 20", "20 de novembro", "amanhã", "segunda", "quinta-feira", "próxima sexta",
 * e um horário opcional: 14h, 14:30, "às 9", "9h30".
 * Um dia da semana pode cair em mais de uma data no período: todas voltam, e quem chama decide (pergunta se forem várias).
 */
export function interpretarData(texto: string, hoje: string, de: string, ate: string): ResultadoData {
  const t = ` ${normalizarTexto(texto)} `;
  const [anoHoje, mesHoje] = hoje.split('-').map(Number);
  const noPeriodo = (d: string) => d >= de && d <= ate;

  // Horário
  let hora: string | null = null;
  // "às 9", "as 14h30" ou "14h", "9h30", "14:30", "14 horas"
  const mh = t.match(/\bas\s+([01]?\d|2[0-3])(?:\s*[:h]\s*([0-5]\d)?)?(?![\d/])/)
    ?? t.match(/\b([01]?\d|2[0-3])\s*(?:h\s*([0-5]\d)?|:([0-5]\d)|\s+horas?\b)(?![\d/])/);
  if (mh) hora = `${mh[1].padStart(2, '0')}:${mh[2] ?? mh[3] ?? '00'}`;
  const semHora = mh ? t.replace(mh[0], ' ') : t;

  const candidatas = new Set<string>();

  // dd/mm[/aaaa] ou dd-mm[-aaaa]
  for (const m of semHora.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g)) {
    const d = Number(m[1]);
    const mes = Number(m[2]);
    let a = m[3] ? Number(m[3]) : anoHoje;
    if (a < 100) a += 2000;
    if (!m[3] && mes < mesHoje - 1) a += 1; // "05/01" dito em novembro é janeiro do ano que vem
    if (valida(a, mes, d)) candidatas.add(iso(a, mes, d));
  }
  // "20 de novembro"
  for (const m of semHora.matchAll(/\b(\d{1,2})\s+de\s+([a-z]+)/g)) {
    const mes = MESES[m[2]];
    if (!mes) continue;
    const a = mes < mesHoje - 1 ? anoHoje + 1 : anoHoje;
    if (valida(a, mes, Number(m[1]))) candidatas.add(iso(a, mes, Number(m[1])));
  }
  // "dia 20" ou só "20"
  if (!candidatas.size) {
    const m = semHora.match(/\bdia\s+(\d{1,2})\b/) ?? semHora.match(/^\s*(\d{1,2})\s*$/);
    if (m) {
      const d = Number(m[1]);
      for (let i = 0; i <= 62; i++) {
        const x = somar(hoje, i);
        if (Number(x.slice(8)) === d && noPeriodo(x)) candidatas.add(x);
      }
    }
  }
  // hoje / amanhã / depois de amanhã
  if (/\bdepois de amanha\b/.test(semHora)) candidatas.add(somar(hoje, 2));
  else if (/\bamanha\b/.test(semHora)) candidatas.add(somar(hoje, 1));
  else if (/\bhoje\b/.test(semHora)) candidatas.add(hoje);
  // dias da semana
  if (!candidatas.size) {
    const nomes = Object.keys(DIAS).sort((a, b) => b.length - a.length);
    const achado = nomes.find((n) => new RegExp(`\\b${n}\\b`).test(semHora));
    if (achado) {
      for (let i = 1; i <= 62; i++) {
        const x = somar(hoje, i);
        if (new Date(`${x}T12:00:00Z`).getUTCDay() === DIAS[achado] && noPeriodo(x)) candidatas.add(x);
      }
      // "próxima segunda": só a primeira
      if (/\bproxim[ao]\b|\bessa\b|\bnesta\b|\bnessa\b/.test(semHora) && candidatas.size > 1) {
        const primeira = [...candidatas].sort()[0];
        candidatas.clear();
        candidatas.add(primeira);
      }
    }
  }

  const datas = [...candidatas].filter(noPeriodo).sort();
  if (!candidatas.size) return { tipo: 'ambiguo', motivo: 'Não encontrei uma data na mensagem.' };
  if (!datas.length) return { tipo: 'ambiguo', motivo: 'A data informada está fora do período disponível.' };
  return { tipo: 'data', datas, hora };
}
