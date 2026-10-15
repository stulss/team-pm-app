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

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;
