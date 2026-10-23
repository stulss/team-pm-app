import { query, withTransaction } from '../../config/db.js';

export const MAX_PER_PROJECT = 20;

export const toRecurrence = (row) =>
  row && {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    assigneeId: row.assignee_id,
    frequency: row.frequency,
    weekday: row.weekday,
    monthDay: row.month_day,
    dueAfterDays: row.due_after_days,
    nextRunDate: row.next_run_date,
    active: row.active,
    createdAt: row.created_at,
  };

// 화면과 날짜 계산이 같은 모양의 규칙을 쓰도록 행에서 뽑는다.
export const ruleOf = (row) => ({
  frequency: row.frequency,
  weekday: row.weekday,
  monthDay: row.month_day,
});

export async function list(projectId) {
  const { rows } = await query(
    'SELECT * FROM task_recurrences WHERE project_id = $1 ORDER BY created_at, id',
    [projectId],
  );
  return rows;
}

export async function findInProject(projectId, id) {
  const { rows } = await query('SELECT * FROM task_recurrences WHERE project_id = $1 AND id = $2', [
    projectId,
    id,
  ]);
  return rows[0] ?? null;
}

// 프로젝트 행을 잠그고 개수를 센 뒤 넣어 상한을 넘지 않게 한다. 상한이면 { full: true }.
export async function insert(input) {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.projectId]);
    const { rows: count } = await client.query(
      'SELECT count(*)::int AS n FROM task_recurrences WHERE project_id = $1',
      [input.projectId],
    );
    if (count[0].n >= MAX_PER_PROJECT) return { full: true };
    const { rows } = await client.query(
      `INSERT INTO task_recurrences
         (project_id, title, description, priority, assignee_id, frequency, weekday, month_day,
          due_after_days, next_run_date, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        input.projectId,
        input.title,
        input.description ?? null,
        input.priority,
        input.assigneeId ?? null,
        input.frequency,
        input.weekday ?? null,
        input.monthDay ?? null,
        input.dueAfterDays ?? null,
        input.nextRunDate,
        input.active,
        input.createdBy,
      ],
    );
    return { row: rows[0] };
  });
}

const COLUMNS = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  assigneeId: 'assignee_id',
  frequency: 'frequency',
  weekday: 'weekday',
  monthDay: 'month_day',
  dueAfterDays: 'due_after_days',
  nextRunDate: 'next_run_date',
  active: 'active',
};

export async function update(id, patch) {
  const sets = [];
  const values = [id];
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${column} = $${values.length}`);
  }
  const { rows } = await query(
    `UPDATE task_recurrences SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    values,
  );
  return rows[0];
}

export async function remove(id) {
  await query('DELETE FROM task_recurrences WHERE id = $1', [id]);
}

// 오늘 만들 차례인 활성 규칙(보관되지 않은 프로젝트만).
export async function listDue(today) {
  const { rows } = await query(
    `SELECT r.* FROM task_recurrences r JOIN projects p ON p.id = r.project_id
     WHERE r.active AND r.next_run_date <= $1 AND p.status <> 'archived'
     ORDER BY r.next_run_date, r.id`,
    [today],
  );
  return rows;
}

// 실행 차례를 선점하며 다음 날짜로 넘긴다. 읽은 값과 같을 때만 바뀌므로 동시에 돌아도 한 번만 성공한다.
export async function claim(id, expectedDate, nextDate) {
  const { rowCount } = await query(
    'UPDATE task_recurrences SET next_run_date = $3 WHERE id = $1 AND next_run_date = $2 AND active',
    [id, expectedDate, nextDate],
  );
  return rowCount === 1;
}
