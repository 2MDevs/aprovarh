/** CPF e telefone: validação e normalização (sem consultar serviços externos). */

export function soDigitos(s: string): string {
  return String(s ?? '').replace(/\D/g, '');
}

/** CPF válido pelos dígitos verificadores. Recusa sequências repetidas (111.111.111-11). */
export function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]);
}

/**
 * Telefone brasileiro com DDD → formato internacional +55DDNNNNNNNN.
 * Aceita com ou sem +55, com ou sem o zero do DDD. Celular precisa ter 9 dígitos começando com 9.
 * Devolve null se não for um número válido.
 */
export function normalizarTelefone(entrada: string): string | null {
  let d = soDigitos(entrada);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1); // 0 + DDD + 8 dígitos
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1); // 0 + DDD + 9 dígitos
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99 || d[1] === '0') return null;
  const numero = d.slice(2);
  if (numero.length === 9 && numero[0] !== '9') return null;
  if (numero.length === 8 && !/^[2-5]/.test(numero)) return null; // fixo; celular de 8 dígitos não existe mais
  return `+55${d}`;
}

/** Nome próprio: letras (com acento), espaço, apóstrofo e hífen. */
export function nomeValido(s: string): boolean {
  return /^[\p{L}][\p{L}' -]*[\p{L}]$/u.test(s.trim()) && s.trim().length >= 2;
}

/** "maria  da silva" → "Maria da Silva" (preposições em minúsculas). */
export function capitalizarNome(s: string): string {
  const minusculas = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  return s.trim().replace(/\s+/g, ' ').toLowerCase().split(' ')
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}
