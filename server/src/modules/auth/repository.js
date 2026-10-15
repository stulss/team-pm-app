import { query } from '../../config/db.js';

export async function insertRefreshToken({ userId, tokenHash, expiresAt }) {
  await query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    userId,
    tokenHash,
    expiresAt,
  ]);
}

export async function findRefreshToken(tokenHash) {
  // revoked_ago_ms 는 DB 시계 기준으로 계산한다. 서버(Node)와 DB 시계가 어긋나도 유예 시간 판정이 틀리지 않게 하기 위함.
  const { rows } = await query(
    `SELECT *, (EXTRACT(EPOCH FROM (now() - revoked_at)) * 1000)::float8 AS revoked_ago_ms
     FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

// 이미 폐기된 토큰이면 아무 행도 갱신되지 않는다 → 회전 경쟁 시 한쪽만 성공한다.
export async function revokeRefreshToken(id) {
  const { rowCount } = await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
    [id],
  );
  return rowCount === 1;
}

export async function revokeAllForUser(userId) {
  await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
}

export async function deleteExpired() {
  await query("DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'");
}
