import pg from 'pg';
import { env } from './env.js';

// Vercel 함수는 인스턴스가 늘고 줄므로 풀은 작게 유지한다.
// Transaction pooler 에서는 prepared statement 를 쓰지 않는다
// (pg 는 query 에 `name` 을 주지 않으면 named statement 를 만들지 않는다 — name 지정 금지).
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.NODE_ENV === 'production' ? 3 : 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  console.error('Unexpected idle client error', err);
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
