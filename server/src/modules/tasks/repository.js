import { query } from '../../config/db.js';

// 칸반 position 간격. 새 작업은 컬럼 맨 아래(최대값 + STEP)에 붙는다. (사이에 끼우는 이동은 M4)
export const POSITION_STEP = 1024;

export const STATUSES = ['todo', 'in_progress', 'review', 'done'];

export const toTask = (row) =>
  row && {
    id: row.id,
    projectId: row.project_id,
    ...(row.project_name !== undefined && { projectName: row.project_name }),
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name } : null,
    createdBy: row.created_by,
    dueDate: row.due_date,
    position: row.position,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const SELECT = `
  SELECT t.*, a.name AS assignee_name, p.name AS project_name
  FROM tasks t
  LEFT JOIN users a ON a.id = t.assignee_id
  JOIN projects p ON p.id = t.project_id`;

export async function findById(id) {
  const { rows } = await query(`${SELECT} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

// filters: { status, assignee('me'|'unassigned'|uuid), priority, dueBefore, q }
function buildWhere(base, filters, currentUserId) {
  const where = [...base.where];
  const params = [...base.params];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (filters.status) add('t.status = ?', filters.status);
  if (filters.priority) add('t.priority = ?', filters.priority);
  if (filters.assignee === 'unassigned') where.push('t.assignee_id IS NULL');
  else if (filters.assignee === 'me') add('t.assignee_id = ?', currentUserId);
  else if (filters.assignee) add('t.assignee_id = ?', filters.assignee);
  if (filters.dueBefore) add('t.due_date <= ?', filters.dueBefore);
  if (filters.q) {
    params.push(`%${filters.q.replace(/[\\%_]/g, '\\$&')}%`);
    const n = params.length;
    where.push(`(t.title ILIKE $${n} OR t.description ILIKE $${n})`);
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function listByProject(projectId, filters, currentUserId, { limit, offset } = {}) {
  const { where, params } = buildWhere(
    { where: ['t.project_id = $1'], params: [projectId] },
    filters,
    currentUserId,
  );
  const paging =
    limit === undefined ? '' : `LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const { rows } = await query(
    `${SELECT} ${where}
     ORDER BY ${filters.grouped ? 't.position ASC' : 't.created_at DESC'}
     ${paging}`,
    limit === undefined ? params : [...params, limit, offset],
  );
  if (limit === undefined) return { rows, total: rows.length };
  const count = await query(`SELECT count(*)::int AS total FROM tasks t ${where}`, params);
  return { rows, total: count.rows[0].total };
}

// 내게 배정된 작업(소속 여부와 무관하게 내가 담당자인 것). 아직 접근 가능한 프로젝트만 보이게 멤버십을 확인한다.
export async function listAssignedTo(user, filters, { limit, offset }) {
  const base = { where: ['t.assignee_id = $1'], params: [user.id] };
  const membership =
    user.role === 'admin'
      ? ''
      : 'AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = t.project_id AND m.user_id = $1)';
  const { where, params } = buildWhere(base, { ...filters, assignee: undefined }, user.id);
  const { rows } = await query(
    `${SELECT} ${where} ${membership}
     ORDER BY (t.status = 'done') ASC, t.due_date ASC NULLS LAST, t.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const count = await query(
    `SELECT count(*)::int AS total FROM tasks t ${where} ${membership}`,
    params,
  );
  return { rows, total: count.rows[0].total };
}

export async function insertTask({
  projectId,
  title,
  description,
  status,
  priority,
  assigneeId,
  dueDate,
  createdBy,
}) {
  const { rows } = await query(
    `INSERT INTO tasks
       (project_id, title, description, status, priority, assignee_id, due_date, created_by,
        position, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
        COALESCE((SELECT max(position) FROM tasks WHERE project_id = $1 AND status = $4), 0) + $9,
        CASE WHEN $4 = 'done' THEN now() END)
     RETURNING id`,
    [
      projectId,
      title,
      description ?? null,
      status,
      priority,
      assigneeId ?? null,
      dueDate ?? null,
      createdBy,
      POSITION_STEP,
    ],
  );
  return findById(rows[0].id);
}

const PATCHABLE = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  assigneeId: 'assignee_id',
  dueDate: 'due_date',
};

// status 가 바뀌면 컬럼 맨 아래로 보내고 completed_at 을 맞춘다. due_date 가 바뀌면 임박 알림 표시를 초기화한다.
export async function updateTask(id, patch, current) {
  const sets = [];
  const params = [id];
  const set = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  for (const [key, column] of Object.entries(PATCHABLE)) {
    if (patch[key] !== undefined) set(column, patch[key]);
  }
  if (patch.dueDate !== undefined) sets.push('due_notified_at = NULL');

  if (patch.status !== undefined && patch.status !== current.status) {
    set('status', patch.status);
    sets.push(patch.status === 'done' ? 'completed_at = now()' : 'completed_at = NULL');
    params.push(current.project_id, patch.status, POSITION_STEP);
    const [pj, st, step] = [params.length - 2, params.length - 1, params.length];
    sets.push(
      `position = COALESCE((SELECT max(position) FROM tasks WHERE project_id = $${pj} AND status = $${st}), 0) + $${step}`,
    );
  }
  if (sets.length === 0) return findById(id);

  await query(`UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  return findById(id);
}

export async function deleteTask(id) {
  const { rowCount } = await query('DELETE FROM tasks WHERE id = $1', [id]);
  return rowCount === 1;
}

export async function unassignUserInProject(client, projectId, userId) {
  await client.query(
    'UPDATE tasks SET assignee_id = NULL, updated_at = now() WHERE project_id = $1 AND assignee_id = $2',
    [projectId, userId],
  );
}
