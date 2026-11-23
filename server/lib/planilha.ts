import zlib from 'node:zlib';

/**
 * Leitura de planilha sem biblioteca externa: .xlsx (Excel / LibreOffice / Google Planilhas) e .csv.
 * Lê só a PRIMEIRA aba e devolve as linhas como listas de texto. Fórmulas valem pelo último valor salvo.
 * Limites contra arquivo malicioso: tamanho do arquivo, tamanho descompactado e número de linhas.
 */
const MAX_DESCOMPACTADO = 30 * 1024 * 1024;
const MAX_LINHAS = 5000;

export class ErroPlanilha extends Error {}

// ── ZIP (o .xlsx é um zip de arquivos XML) ──────────────────────────────────
function lerZip(buf: Buffer): Map<string, () => Buffer> {
  // Fim do diretório central: assinatura 0x06054b50, procurada de trás para frente.
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new ErroPlanilha('O arquivo não parece ser uma planilha do Excel (.xlsx).');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const arquivos = new Map<string, () => Buffer>();
  let usado = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ErroPlanilha('Planilha corrompida.');
    const metodo = buf.readUInt16LE(p + 10);
    const compactado = buf.readUInt32LE(p + 20);
    const tamanho = buf.readUInt32LE(p + 24);
    const lenNome = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + lenNome).toString('utf8');
    p += 46 + lenNome + lenExtra + lenComent;
    arquivos.set(nome, () => {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ErroPlanilha('Planilha corrompida.');
      const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const dados = buf.subarray(inicio, inicio + compactado);
      usado += tamanho;
      if (tamanho > MAX_DESCOMPACTADO || usado > MAX_DESCOMPACTADO) throw new ErroPlanilha('Planilha grande demais.');
      if (metodo === 0) return Buffer.from(dados);
      if (metodo === 8) return zlib.inflateRawSync(dados, { maxOutputLength: MAX_DESCOMPACTADO });
      throw new ErroPlanilha('Formato de planilha não suportado.');
    });
  }
  return arquivos;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function texto(xml: string): string {
  return xml.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e.toLowerCase()]);
}
/** Junta todos os <t> de um trecho (texto com formatação vem em vários pedaços). */
const juntarT = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => texto(m[1])).join('');

/** Coluna "AB" → índice 27. */
function indiceColuna(ref: string): number {
  const letras = ref.replace(/\d+$/, '').toUpperCase();
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function lerXlsx(buf: Buffer): string[][] {
  const zip = lerZip(buf);
  const ler = (nome: string) => zip.get(nome)?.().toString('utf8') ?? null;
  // Primeira aba (pela ordem do workbook).
  let caminho = 'xl/worksheets/sheet1.xml';
  const wb = ler('xl/workbook.xml');
  const rels = ler('xl/_rels/workbook.xml.rels');
  const primeira = wb?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (primeira && rels) {
    const alvo = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${primeira}"`))?.match(/Target="([^"]+)"/)?.[1];
    if (alvo) caminho = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`;
  }
  const folha = ler(caminho);
  if (!folha) throw new ErroPlanilha('Não encontrei a primeira aba da planilha.');
  const compartilhados = [...(ler('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => juntarT(m[1]));

  const linhas: string[][] = [];
  for (const lm of folha.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (linhas.length >= MAX_LINHAS) throw new ErroPlanilha(`A planilha tem mais de ${MAX_LINHAS} linhas. Divida em arquivos menores.`);
    const linha: string[] = [];
    for (const cm of lm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const tipo = attrs.match(/\bt="([^"]+)"/)?.[1];
      const corpo = cm[2] ?? '';
      let valor = '';
      if (tipo === 's') valor = compartilhados[Number(corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1])] ?? '';
      else if (tipo === 'inlineStr') valor = juntarT(corpo);
      else valor = texto(corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      const i = ref ? indiceColuna(ref) : linha.length;
      while (linha.length < i) linha.push('');
      linha[i] = valor.trim();
    }
    linhas.push(linha);
  }
  return linhas;
}

function lerCsv(buf: Buffer): string[][] {
  let t = buf.toString('utf8');
  if (t.includes('�')) t = buf.toString('latin1'); // CSV salvo pelo Excel em Windows
  t = t.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo.trim()); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo.trim()); linhas.push(linha); linha = []; campo = '';
      if (linhas.length > MAX_LINHAS) throw new ErroPlanilha(`A planilha tem mais de ${MAX_LINHAS} linhas. Divida em arquivos menores.`);
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo.trim()); linhas.push(linha); }
  return linhas;
}

/** Lê .xlsx ou .csv (pelo conteúdo, não pela extensão). Linhas totalmente vazias são descartadas. */
export function lerPlanilha(buf: Buffer): string[][] {
  const zipado = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  const linhas = zipado ? lerXlsx(buf) : lerCsv(buf);
  return linhas.filter((l) => l.some((c) => c));
}

// ── Candidatos a partir das linhas ─────────────────────────────────────────
const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

export interface LinhaCandidato { linha: number; nome: string; sobrenome: string; telefone: string; unidade: string }

/**
 * Acha as colunas pelo cabeçalho (nome, sobrenome, nome completo, telefone/celular/whatsapp, unidade/loja)
 * e devolve uma linha por pessoa. Se só houver "nome completo", separa no primeiro espaço.
 */
export function candidatosDaPlanilha(linhas: string[][]): { candidatos: LinhaCandidato[]; colunas: string[] } {
  const iCab = linhas.findIndex((l) => l.some((c) => /telefone|celular|whats|fone|contato/.test(sem(c))));
  if (iCab < 0) throw new ErroPlanilha('Não encontrei a coluna do telefone. A primeira linha precisa ter os títulos, por exemplo: Nome, Sobrenome, Telefone.');
  const cab = linhas[iCab].map(sem);
  const achar = (...testes: ((c: string) => boolean)[]) => { for (const t of testes) { const i = cab.findIndex(t); if (i >= 0) return i; } return -1; };
  const iCompleto = achar((c) => c === 'nomecompleto' || c === 'nomeecompleto' || c === 'candidato');
  const iNome = achar((c) => c === 'nome' || c === 'primeironome', (c) => c.startsWith('nome') && c !== 'nomecompleto');
  const iSobrenome = achar((c) => c.startsWith('sobrenome') || c === 'ultimonome');
  const iTel = achar((c) => /telefone|celular|whats|fone|contato/.test(c));
  const iUnidade = achar((c) => /unidade|loja|filial/.test(c));
  if (iNome < 0 && iCompleto < 0) throw new ErroPlanilha('Não encontrei a coluna do nome. Use o título "Nome" ou "Nome completo".');
  const colunas = [iNome >= 0 && 'Nome', iSobrenome >= 0 && 'Sobrenome', iCompleto >= 0 && 'Nome completo', 'Telefone', iUnidade >= 0 && 'Unidade'].filter(Boolean) as string[];

  const candidatos: LinhaCandidato[] = [];
  for (let i = iCab + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const pegar = (j: number) => (j >= 0 ? (l[j] ?? '').replace(/\s+/g, ' ').trim() : '');
    let nome = pegar(iNome);
    let sobrenome = pegar(iSobrenome);
    const completo = pegar(iCompleto);
    if (completo && (!nome || !sobrenome)) {
      const [primeiro, ...resto] = completo.split(' ');
      if (!nome) nome = primeiro;
      if (!sobrenome) sobrenome = nome === primeiro ? resto.join(' ') : completo.replace(new RegExp(`^${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '');
    }
    if (nome && !sobrenome && nome.includes(' ')) {
      const [primeiro, ...resto] = nome.split(' ');
      nome = primeiro;
      sobrenome = resto.join(' ');
    }
    // Telefone que o Excel guardou como número (5521999990000 ou 2.19999E+10) vira texto de dígitos.
    let tel = pegar(iTel);
    if (/^\d+(\.\d+)?E\+\d+$/i.test(tel)) tel = Number(tel).toFixed(0);
    tel = tel.replace(/\.0$/, '');
    if (!nome && !tel) continue;
    candidatos.push({ linha: i + 1, nome, sobrenome, telefone: tel, unidade: pegar(iUnidade) });
  }
  return { candidatos, colunas };
}
