import { query } from '../../config/db.js';

export const RETENTION_DAYS = 90;

export const toNotification = (row) =>
  row && {
    id: row.id,
    type: row.type,
    taskId: row.task_id,
    projectId: row.project_id,
    actor: row.actor_id ? { id: row.actor_id, name: row.actor_name } : null,
    message: row.message,
    isRead: row.is_read,
    createdAt: row.created_at,
  };

// 작업 알림은 작업을 거쳐, 채팅 멘션 알림(task_id 없음)은 project_id 로 프로젝트를 구한다.
const SELECT = `
  SELECT n.id, n.user_id, n.type, n.task_id, n.actor_id, n.message, n.is_read, n.created_at,
         COALESCE(t.project_id, n.project_id) AS project_id, a.name AS actor_name
  FROM notifications n
  LEFT JOIN tasks t ON t.id = n.task_id
  LEFT JOIN users a ON a.id = n.actor_id`;

// rows: [{ userId, type, taskId, actorId, message }] — 한 번에 여러 건을 넣고 만든 행(작업·배정자 정보 포함)을 돌려준다.
// 삽입과 조회를 한 쿼리(CTE)로 합치면 안 된다: PostgreSQL 은 데이터 변경 CTE 가 만든 행을 같은 쿼리의 SELECT 에서
// 보여주지 않으므로(RETURNING 으로만 접근 가능), 삽입 후 ID 로 다시 조회한다.
export async function insertMany(rows, client = { query }) {
  if (rows.length === 0) return [];
  const { rows: created } = await client.query(
    `INSERT INTO notifications (user_id, type, task_id, actor_id, message, project_id)
     SELECT * FROM unnest($1::uuid[], $2::notification_type[], $3::uuid[], $4::uuid[], $5::text[], $6::uuid[])
     RETURNING id`,
    [
      rows.map((r) => r.userId),
      rows.map((r) => r.type),
      rows.map((r) => r.taskId ?? null),
      rows.map((r) => r.actorId ?? null),
      rows.map((r) => r.message),
      rows.map((r) => r.projectId ?? null),
    ],
  );
  const { rows: inserted } = await client.query(
    `${SELECT} WHERE n.id = ANY($1::uuid[]) ORDER BY n.created_at ASC, n.id ASC`,
    [created.map((r) => r.id)],
  );
  return inserted;
}

export async function list(userId, { unread, limit, offset }) {
  const where = unread ? 'AND n.is_read = false' : '';
  const { rows } = await query(
    `${SELECT} WHERE n.user_id = $1 ${where}
     ORDER BY n.created_at DESC, n.id DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  const count = await query(
    `SELECT count(*)::int AS total FROM notifications n WHERE n.user_id = $1 ${where}`,
    [userId],
  );
  return { rows, total: count.rows[0].total };
}

export async function unreadCount(userId) {
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false',
    [userId],
  );
  return rows[0].n;
}

// 본인 알림만. 없거나 남의 알림이면 false.
export async function markRead(id, userId) {
  const { rowCount } = await query(
    'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return rowCount === 1;
}

export async function markAllRead(userId) {
  const { rowCount } = await query(
    'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
    [userId],
  );
  return rowCount;
}

export async function deleteOlderThan(days = RETENTION_DAYS) {
  const { rowCount } = await query(
    "DELETE FROM notifications WHERE created_at < now() - ($1 || ' days')::interval",
    [String(days)],
  );
  return rowCount;
}

// 알림을 받을 수 있는 사용자: 활성이고 해당 프로젝트의 멤버.
export async function filterNotifiable(projectId, userIds) {
  if (userIds.length === 0) return [];
  const { rows } = await query(
    `SELECT u.id FROM users u
     JOIN project_members m ON m.user_id = u.id AND m.project_id = $1
     WHERE u.id = ANY($2::uuid[]) AND u.is_active`,
    [projectId, userIds],
  );
  return rows.map((r) => r.id);
}

// 마감 알림 대상을 "확보"한다: 같은 트랜잭션에서 알림 표시 컬럼을 채우고 해당 작업을 돌려준다.
// 이미 알린 작업(표시 컬럼이 NULL 이 아님), 완료된 작업, 담당자가 없거나 비활성인 작업,
// 보관된 프로젝트의 작업, 담당자가 더 이상 멤버가 아닌 작업은 제외한다.
// due: 'soon' = 마감일이 today..today+1, 'overdue' = 마감일이 today 보다 이전.
export async function claimDueTasks(client, kind, today) {
  const isOverdue = kind === 'overdue';
  const column = isOverdue ? 'overdue_notified_at' : 'due_notified_at';
  const dueCondition = isOverdue
    ? 't.due_date < $1::date'
    : 't.due_date >= $1::date AND t.due_date <= $1::date + 1';
  const { rows } = await client.query(
    `UPDATE tasks SET ${column} = now()
     WHERE id IN (
       SELECT t.id FROM tasks t
       JOIN projects p ON p.id = t.project_id AND p.status = 'active'
       JOIN users u ON u.id = t.assignee_id AND u.is_active
       JOIN project_members m ON m.project_id = t.project_id AND m.user_id = t.assignee_id
       WHERE t.status <> 'done' AND t.${column} IS NULL AND ${dueCondition}
       FOR UPDATE OF t SKIP LOCKED
     )
     RETURNING id, title, assignee_id, due_date`,
    [today],
  );
  return rows;
}
