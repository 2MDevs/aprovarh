import crypto from 'node:crypto';
import { env } from '../config/env.ts';

/** Chave mestra de 32 bytes vinda de SETTINGS_ENCRYPTION_KEY (hex de 64 caracteres ou base64). */
function loadKey(): Buffer {
  const raw = env.SETTINGS_ENCRYPTION_KEY.trim();
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    console.error('[aprovaRH] SETTINGS_ENCRYPTION_KEY precisa ter 32 bytes (64 caracteres hex). Gere com: openssl rand -hex 32');
    process.exit(1);
  }
  return key;
}
const MASTER = loadKey();

/** Subchaves derivadas para cada uso, para não usar a mesma chave em finalidades diferentes. */
function derive(purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', MASTER, Buffer.alloc(0), `aprovarh:${purpose}`, 32));
}
const ENC_KEY = derive('aes-256-gcm');
const HMAC_KEY = derive('hmac');

const PREFIX = 'v1:';

/** Cifra um texto com AES-256-GCM. Saída: "v1:" + base64(iv | tag | dados). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decrypt(payload: string): string {
  if (!payload.startsWith(PREFIX)) throw new Error('Formato de dado cifrado desconhecido.');
  const buf = Buffer.from(payload.slice(PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

/** Cifra um buffer (arquivos). Mesmo formato binário: iv(12) | tag(16) | dados. */
export function encryptBuffer(data: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const out = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), out]);
}

export function decryptBuffer(buf: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** HMAC com chave do servidor: usado para tokens e códigos que precisam ser encontrados pelo hash. */
export function hmac(data: string): string {
  return crypto.createHmac('sha256', HMAC_KEY).update(data).digest('hex');
}

/** Token aleatório seguro para cookies (sessão, dispositivo, desafio). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Código numérico de N dígitos (2FA). */
export function randomDigits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += crypto.randomInt(0, 10).toString();
  return s;
}

/** Texto aleatório de um alfabeto (chaves de API). */
export function randomFromAlphabet(n: number, alphabet: string): string {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[crypto.randomInt(0, alphabet.length)];
  return s;
}

/** Comparação em tempo constante. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
