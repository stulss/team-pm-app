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
  // Vercel Cron 이 보내는 Authorization: Bearer <CRON_SECRET> 검증용. 없으면 cron 엔드포인트는 비활성.
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 chars').optional(),
  // "오늘/내일" 마감 판정에 쓰는 시간대
  APP_TIMEZONE: z
    .string()
    .default('Asia/Seoul')
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'APP_TIMEZONE must be a valid IANA time zone'),
  // DB TLS 서버 인증서 검증(기본 켜짐). 인증서 문제로 DB 에 못 붙을 때만 비상용으로 false.
  DB_SSL_VERIFY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // 'false' 로 두면 새 가입을 막는다(첫 계정은 항상 허용). 팀 구성이 끝난 뒤 닫는 용도.
  ALLOW_REGISTRATION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

// Vercel-Supabase 연동은 POSTGRES_URL(Transaction pooler 6543), POSTGRES_URL_NON_POOLING(5432)을 주입한다.
// 같은 비밀값을 복사해 두지 않도록 DATABASE_URL / DIRECT_URL 이 없으면 이 값을 사용한다.
// 연결 문자열의 sslmode/supa/pgbouncer 같은 옵션은 pg 가 TLS 설정을 덮어쓰거나 비표준이라 제거한다.
// TLS 는 config/ssl.js 가 코드에서 직접 설정한다(내장한 Supabase CA 로 서버 인증서 검증).
export function normalizeDbUrl(url) {
  if (!url) return url;
  const u = new URL(url);
  for (const key of ['sslmode', 'supa', 'pgbouncer']) u.searchParams.delete(key);
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
