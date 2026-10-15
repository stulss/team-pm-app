import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Supabase Transaction pooler (6543). 서버 런타임용.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // 마이그레이션용 direct/Session pooler 연결 (런타임에는 사용하지 않음)
  DIRECT_URL: z.string().optional(),
  // Socket.io Redis adapter. 없으면 단일 인스턴스 모드(로컬 개발).
  REDIS_URL: z.string().optional(),
  CLIENT_ORIGIN: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
});

// Vercel-Supabase 연동은 POSTGRES_URL(Transaction pooler 6543), POSTGRES_URL_NON_POOLING(5432)을 주입한다.
// 같은 비밀값을 복사해 두지 않도록 DATABASE_URL / DIRECT_URL 이 없으면 이 값을 사용한다.
// 연결 문자열의 sslmode=require 는 pg 에서 인증서 검증 실패를 일으킬 수 있고 supa=... 같은 비표준 옵션도 있어,
// sslmode=no-verify 로 정규화한다. (TODO M9: Supabase CA 인증서로 검증하도록 강화)
export function normalizeDbUrl(url) {
  if (!url) return url;
  const u = new URL(url);
  u.searchParams.delete('supa');
  u.searchParams.delete('pgbouncer');
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) u.searchParams.set('sslmode', 'no-verify');
  return u.toString();
}

const raw = {
  ...process.env,
  DATABASE_URL: normalizeDbUrl(process.env.DATABASE_URL || process.env.POSTGRES_URL),
  DIRECT_URL: normalizeDbUrl(process.env.DIRECT_URL || process.env.POSTGRES_URL_NON_POOLING),
};

const parsed = schema.safeParse(raw);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;
