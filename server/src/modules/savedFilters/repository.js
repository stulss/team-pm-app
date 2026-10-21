import { query, withTransaction } from '../../config/db.js';

export const MAX_FILTERS_PER_USER = 20;

export const toSavedFilter = (row) =>
  row && { id: row.id, name: row.name, filters: row.filters, createdAt: row.created_at };

export async function list(projectId, userId) {
  const { rows } = await query(
    'SELECT * FROM saved_filters WHERE project_id = $1 AND user_id = $2 ORDER BY lower(name)',
    [projectId, userId],
  );
  return rows;
}

// 내 필터 한 건(없거나 남의 것이면 null).
export async function findOwn(projectId, userId, filterId) {
  const { rows } = await query(
    'SELECT * FROM saved_filters WHERE project_id = $1 AND user_id = $2 AND id = $3',
    [projectId, userId, filterId],
  );
  return rows[0] ?? null;
}

// 같은 사용자·프로젝트의 행을 잠그고 개수를 센 뒤 넣어 상한(20)을 넘지 않게 한다.
// 상한이면 { full: true }, 같은 이름이 있으면 { duplicate: true }.
export async function insert({ projectId, userId, name, filters }) {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      projectId,
      userId,
    ]);
    const { rows: count } = await client.query(
      'SELECT count(*)::int AS n FROM saved_filters WHERE project_id = $1 AND user_id = $2',
      [projectId, userId],
    );
    if (count[0].n >= MAX_FILTERS_PER_USER) return { full: true };
    const { rows } = await client.query(
      `INSERT INTO saved_filters (project_id, user_id, name, filters)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT DO NOTHING RETURNING *`,
      [projectId, userId, name, JSON.stringify(filters)],
    );
    return rows[0] ? { row: rows[0] } : { duplicate: true };
  });
}

export async function remove(filterId) {
  await query('DELETE FROM saved_filters WHERE id = $1', [filterId]);
}
