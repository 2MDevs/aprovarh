import bcrypt from 'bcryptjs';

const ROUNDS = 12;

/** Regra padrão: mínimo de 10 caracteres, com letras e números. Devolve a mensagem de erro ou null. */
export function validarSenha(senha: string): string | null {
  if (typeof senha !== 'string' || senha.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (senha.length > 128) return 'A senha pode ter no máximo 128 caracteres.';
  if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) return 'A senha precisa ter letras e números.';
  return null;
}

export function validarPin(pin: string): string | null {
  return /^\d{4,8}$/.test(pin) ? null : 'O PIN precisa ter de 4 a 8 números.';
}

export const hashSenha = (senha: string) => bcrypt.hash(senha, ROUNDS);
/** Hash gerado uma vez para gastar o mesmo tempo quando o e-mail não existe (não revela quais e-mails têm conta). */
let dummy: string | null = null;

export async function conferirSenha(senha: string, hash: string | null): Promise<boolean> {
  if (hash) return bcrypt.compare(senha, hash);
  dummy ??= await bcrypt.hash('aprovarh-dummy', ROUNDS);
  await bcrypt.compare(senha, dummy);
  return false;
}
