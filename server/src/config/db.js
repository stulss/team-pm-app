import pg from 'pg';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
import { buildSsl } from './ssl.js';

// date 컬럼(마감일)은 JS Date 로 바꾸면 서버 시간대에 따라 하루씩 밀릴 수 있으므로 'YYYY-MM-DD' 문자열 그대로 읽는다.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

// Vercel 함수는 인스턴스가 늘고 줄므로 풀은 작게 유지한다.
// Transaction pooler 에서는 prepared statement 를 쓰지 않는다
// (pg 는 query 에 `name` 을 주지 않으면 named statement 를 만들지 않는다 — name 지정 금지).
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.NODE_ENV === 'production' ? 3 : 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  ssl: buildSsl(env.DATABASE_URL, env.DB_SSL_VERIFY),
});

pool.on('error', (err) => {
  logger.error({ err }, 'unexpected idle db client error');
});

export const query = (text, params) => pool.query(text, params);

// 트랜잭션 헬퍼. fn 은 같은 연결(client)로 쿼리해야 한다.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
