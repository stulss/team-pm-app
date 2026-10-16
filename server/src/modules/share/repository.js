import { query } from '../../config/db.js';

export const MAX_ACTIVE_PER_PROJECT = 5;
export const STALE_DAYS = 30;

export const toLink = (row) =>
  row && {
    id: row.id,
    createdBy: row.created_by ? { id: row.created_by, name: row.creator_name } : null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
  };

const ACTIVE = 'l.revoked_at IS NULL AND l.expires_at > now()';

export async function countActive(projectId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM share_links l WHERE l.project_id = $1 AND ${ACTIVE}`,
    [projectId],
  );
  return rows[0].n;
}

export async function insert({ projectId, createdBy, tokenHash, expiresInDays }) {
  const { rows } = await query(
    `INSERT INTO share_links (project_id, created_by, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)
     RETURNING id, expires_at`,
    [projectId, createdBy, tokenHash, String(expiresInDays)],
  );
  return rows[0];
}

export async function listActive(projectId) {
  const { rows } = await query(
    `SELECT l.*, u.name AS creator_name
     FROM share_links l
     LEFT JOIN users u ON u.id = l.created_by
     WHERE l.project_id = $1 AND ${ACTIVE}
     ORDER BY l.created_at DESC`,
    [projectId],
  );
  return rows;
}

// 이미 폐기됐거나 다른 프로젝트의 링크면 갱신되는 행이 없다.
export async function revoke(projectId, linkId) {
  const { rowCount } = await query(
    'UPDATE share_links SET revoked_at = now() WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL',
    [linkId, projectId],
  );
  return rowCount === 1;
}

// 유효한(만료·폐기 아님) 링크와 그 프로젝트. 없으면 null.
export async function findActiveByHash(tokenHash) {
  const { rows } = await query(
    `SELECT l.id, l.project_id, l.expires_at, p.name AS project_name, p.status AS project_status
     FROM share_links l
     JOIN projects p ON p.id = l.project_id
     WHERE l.token_hash = $1 AND ${ACTIVE}`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function touchView(id) {
  await query(
    'UPDATE share_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = $1',
    [id],
  );
}

export async function deleteStale() {
  const { rowCount } = await query(
    `DELETE FROM share_links
     WHERE expires_at < now() - ($1 || ' days')::interval
        OR revoked_at < now() - ($1 || ' days')::interval`,
    [String(STALE_DAYS)],
  );
  return rowCount;
}
