import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.ts';
import type { Db } from '../db/pool.ts';
import { decryptBuffer, encryptBuffer, sha256 } from './crypto.ts';

/**
 * Armazenamento de arquivos: o conteúdo é cifrado com AES-256-GCM e gravado em STORAGE_DIR/arquivos,
 * com nome aleatório (o nome original fica só no banco). O tipo é conferido pelo conteúdo do arquivo.
 */
const RAIZ = path.resolve(env.STORAGE_DIR, 'arquivos');

export type TipoAceito = 'pdf' | 'doc' | 'docx' | 'jpg' | 'png';

export const MIME: Record<TipoAceito, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  png: 'image/png',
};

/** Descobre o tipo real pelos primeiros bytes. Devolve null para qualquer outra coisa. */
export function detectarTipo(buf: Buffer): TipoAceito | null {
  if (buf.length < 8) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  // Word antigo (.doc): contêiner OLE
  if (buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'doc';
  // Word novo (.docx): ZIP que contém a pasta "word/"
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const inicio = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString('latin1');
    if (inicio.includes('[Content_Types].xml') && inicio.includes('word/')) return 'docx';
  }
  return null;
}

/** Nome seguro para guardar e mostrar (sem caminho, sem caracteres de controle). */
export function sanearNome(nome: string, ext: string): string {
  const base = path.basename(String(nome || 'arquivo')).replace(/\.[^.]*$/, '')
    .normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${base || 'arquivo'}.${ext}`;
}

export interface ArquivoGuardado { id: string; caminho: string }

/** Cifra e grava o arquivo; registra no banco (dentro da transação recebida). */
export async function guardarArquivo(db: Db, conteudo: Buffer, nomeOriginal: string, tipo: TipoAceito): Promise<ArquivoGuardado> {
  const id = crypto.randomUUID();
  const relativo = path.join(id.slice(0, 2), `${id}.bin`);
  const destino = path.join(RAIZ, relativo);
  await fs.promises.mkdir(path.dirname(destino), { recursive: true, mode: 0o750 });
  await fs.promises.writeFile(destino, encryptBuffer(conteudo), { mode: 0o640, flag: 'wx' });
  try {
    await db.query(
      `INSERT INTO arquivos (id, nome_original, tipo_mime, extensao, tamanho, sha256, caminho) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, sanearNome(nomeOriginal, tipo), MIME[tipo], tipo, conteudo.length, sha256(conteudo), relativo],
    );
  } catch (err) {
    await fs.promises.rm(destino, { force: true });
    throw err;
  }
  return { id, caminho: relativo };
}

/** Apaga do disco arquivos gravados numa transação que foi desfeita. */
export async function descartarArquivos(lista: ArquivoGuardado[]) {
  await Promise.all(lista.map((a) => fs.promises.rm(path.join(RAIZ, a.caminho), { force: true })));
}

/** Lê e decifra; confere o SHA-256. Usado nos downloads da etapa 4. */
export async function lerArquivo(caminho: string, sha: string): Promise<Buffer> {
  const conteudo = decryptBuffer(await fs.promises.readFile(path.join(RAIZ, caminho)));
  if (sha256(conteudo) !== sha) throw new Error('Arquivo corrompido: o conteúdo não confere com o registro.');
  return conteudo;
}
