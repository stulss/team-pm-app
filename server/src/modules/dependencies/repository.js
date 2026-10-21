import { query, withTransaction } from '../../config/db.js';

export const MAX_BLOCKERS_PER_TASK = 10;

export const toLinked = (row) =>
  row && { id: row.id, title: row.title, status: row.status, dueDate: row.due_date };

// 이 작업의 선행 작업(blockedBy)과 이 작업을 기다리는 작업(blocks).
export async function list(taskId) {
  const { rows: blockedBy } = await query(
    `SELECT b.id, b.title, b.status, b.due_date
     FROM task_dependencies d JOIN tasks b ON b.id = d.depends_on_id
     WHERE d.task_id = $1 ORDER BY d.created_at, b.id`,
    [taskId],
  );
  const { rows: blocks } = await query(
    `SELECT w.id, w.title, w.status, w.due_date
     FROM task_dependencies d JOIN tasks w ON w.id = d.task_id
     WHERE d.depends_on_id = $1 ORDER BY d.created_at, w.id`,
    [taskId],
  );
  return { blockedBy, blocks };
}

// 선행 작업을 추가한다. 프로젝트 단위 advisory lock 으로 동시에 서로를 선행으로 거는 경우도 직렬화한다.
// 결과: 'ok' | 'exists' | 'full' | 'cycle'
export async function add(task, dependsOnId) {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      task.project_id,
      'task_dependencies',
    ]);
    const { rows: stats } = await client.query(
      `SELECT count(*)::int AS n,
              bool_or(depends_on_id = $2) AS has
       FROM task_dependencies WHERE task_id = $1`,
      [task.id, dependsOnId],
    );
    if (stats[0].has) return 'exists';
    if (stats[0].n >= MAX_BLOCKERS_PER_TASK) return 'full';
    // dependsOn 의 선행 사슬(거슬러 올라간 모든 선행 작업)에 이 작업이 있으면 순환이 된다.
    const { rowCount } = await client.query(
      `WITH RECURSIVE chain AS (
         SELECT depends_on_id AS id FROM task_dependencies WHERE task_id = $1
         UNION
         SELECT d.depends_on_id FROM task_dependencies d JOIN chain c ON d.task_id = c.id
       )
       SELECT 1 FROM chain WHERE id = $2 LIMIT 1`,
      [dependsOnId, task.id],
    );
    if (rowCount > 0) return 'cycle';
    await client.query(
      'INSERT INTO task_dependencies (task_id, depends_on_id, project_id) VALUES ($1, $2, $3)',
      [task.id, dependsOnId, task.project_id],
    );
    return 'ok';
  });
}

export async function remove(taskId, dependsOnId) {
  const { rowCount } = await query(
    'DELETE FROM task_dependencies WHERE task_id = $1 AND depends_on_id = $2',
    [taskId, dependsOnId],
  );
  return rowCount === 1;
}
