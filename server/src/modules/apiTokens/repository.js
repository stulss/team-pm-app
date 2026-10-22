import { query } from '../../config/db.js';

export const toToken = (row) =>
  row && {
    id: row.id,
    name: row.name,
    scope: row.scope,
    prefix: row.prefix,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };

export async function insert({ userId, name, scope, tokenHash, prefix, expiresAt }) {
  const { rows } = await query(
    `INSERT INTO api_tokens (user_id, name, scope, token_hash, prefix, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, name, scope, tokenHash, prefix, expiresAt],
  );
  return rows[0];
}

// 폐기하지 않은 토큰(만료된 것도 포함: 목록에서 "만료됨"으로 보여 준다).
export async function listForUser(userId) {
  const { rows } = await query(
    'SELECT * FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC',
    [userId],
  );
  return rows;
}

// 지금 쓸 수 있는 토큰 수(한도 검사용).
export async function countActive(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM api_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [userId],
  );
  return rows[0].n;
}

export async function revoke(userId, id) {
  const { rowCount } = await query(
    'UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [id, userId],
  );
  return rowCount > 0;
}

export async function findByHash(tokenHash) {
  const { rows } = await query(
    `SELECT t.*, u.is_active
     FROM api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

// 마지막 사용 시각은 1분보다 오래됐을 때만 갱신한다(요청마다 쓰지 않게).
export async function touch(id) {
  await query(
    `UPDATE api_tokens SET last_used_at = now()
     WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
    [id],
  );
}

// 폐기되거나 만료된 지 오래된 토큰 행을 지운다(일일 정리). 막 폐기한 것은 목록·감사에 잠시 남겨 둔다.
export async function deleteStale(days) {
  const { rowCount } = await query(
    `DELETE FROM api_tokens
     WHERE revoked_at < now() - ($1 || ' days')::interval
        OR expires_at < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return rowCount;
}

// 계정 삭제(익명화) 때 쓴다.
export async function deleteForUser(userId) {
  await query('DELETE FROM api_tokens WHERE user_id = $1', [userId]);
}
