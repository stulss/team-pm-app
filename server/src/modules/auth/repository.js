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
  await query(
    "DELETE FROM email_tokens WHERE expires_at < now() - interval '1 day' OR used_at < now() - interval '1 day'",
  );
}

// 같은 종류의 이전 링크는 새로 발급하는 순간 쓸 수 없게 한다.
export async function insertEmailToken({ userId, kind, tokenHash, expiresAt }) {
  await query(
    'UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL',
    [userId, kind],
  );
  await query(
    'INSERT INTO email_tokens (user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, kind, tokenHash, expiresAt],
  );
}

// 가장 최근 발급 시각부터 지난 초(DB 시계 기준). 없으면 null. 메일 폭탄 방지용 쿨다운에 쓴다.
export async function secondsSinceLastEmailToken(userId, kind) {
  const { rows } = await query(
    `SELECT EXTRACT(EPOCH FROM (now() - max(created_at)))::float8 AS secs
     FROM email_tokens WHERE user_id = $1 AND kind = $2`,
    [userId, kind],
  );
  return rows[0]?.secs ?? null;
}

// 유효한(미사용·미만료) 토큰을 한 번에 소비한다. 동시에 두 번 눌러도 한 번만 성공한다.
export async function consumeEmailToken(tokenHash, kind) {
  const { rows } = await query(
    `UPDATE email_tokens SET used_at = now()
     WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [tokenHash, kind],
  );
  return rows[0]?.user_id ?? null;
}
