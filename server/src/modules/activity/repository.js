import { query } from '../../config/db.js';

export const RETENTION_DAYS = 180;

export const toActivity = (row) =>
  row && {
    id: row.id,
    seq: Number(row.seq),
    action: row.action,
    taskId: row.task_id,
    actor: row.actor_id ? { id: row.actor_id, name: row.actor_name } : null,
    meta: row.meta,
    createdAt: row.created_at,
  };

export async function insert({ projectId, taskId = null, actorId = null, action, meta = {} }) {
  await query(
    `INSERT INTO activity_logs (project_id, task_id, actor_id, action, meta)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [projectId, taskId, actorId, action, JSON.stringify(meta)],
  );
}

// 최신순. before 는 이전 페이지의 마지막 seq(커서). limit+1 건을 읽어 다음 페이지 유무를 판단한다.
export async function list(projectId, { limit, before, taskId, action, excludeActions }) {
  const params = [projectId];
  const where = ['l.project_id = $1'];
  if (before !== undefined) {
    params.push(before);
    where.push(`l.seq < $${params.length}`);
  }
  if (taskId) {
    params.push(taskId);
    where.push(`l.task_id = $${params.length}`);
  }
  if (action) {
    params.push(action);
    where.push(`l.action = $${params.length}`);
  }
  if (excludeActions?.length) {
    params.push(excludeActions);
    where.push(`l.action <> ALL($${params.length}::text[])`);
  }
  params.push(limit + 1);
  const { rows } = await query(
    `SELECT l.*, a.name AS actor_name
     FROM activity_logs l
     LEFT JOIN users a ON a.id = l.actor_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.seq DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function deleteOlderThan(days) {
  const { rowCount } = await query(
    "DELETE FROM activity_logs WHERE created_at < now() - ($1 || ' days')::interval",
    [String(days)],
  );
  return rowCount;
}
