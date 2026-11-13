import 'dotenv/config';
import { z } from 'zod';

/**
 * Variáveis de ambiente obrigatórias do aprovaRH.
 * Valores padrão só onde a infraestrutura padrão define um padrão.
 * Configurações que podem ser trocadas pela tela Integração ficam em core/settings.ts.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  /** 32 bytes em hexadecimal (64 caracteres) ou base64. Nunca vai para o banco nem para o GitHub. */
  SETTINGS_ENCRYPTION_KEY: z.string().min(32),
  DEVELOPER_EMAILS: z.string().default(''),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_INITIAL_PASSWORD: z.string().optional(),
  /** Pasta onde ficam os arquivos cifrados (currículos, fotos). Fora da pasta pública. */
  STORAGE_DIR: z.string().default('./storage'),
  /** Quantos proxies existem na frente do Node (ex.: Nginx = 1), para ler o IP real. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const faltando = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`[aprovaRH] Variáveis de ambiente inválidas ou ausentes no .env:\n${faltando}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

export const developerEmails = new Set(
  env.DEVELOPER_EMAILS.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
);

export function isDeveloperEmail(email: string): boolean {
  return developerEmails.has(email.trim().toLowerCase());
}
