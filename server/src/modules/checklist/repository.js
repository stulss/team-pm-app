import { query, withTransaction } from '../../config/db.js';
import { POSITION_STEP } from '../../utils/position.js';

export const MAX_ITEMS_PER_TASK = 50;

export const toItem = (row) =>
  row && { id: row.id, content: row.content, isDone: row.is_done, position: row.position };

export async function list(taskId) {
  const { rows } = await query(
    'SELECT * FROM checklist_items WHERE task_id = $1 ORDER BY position, created_at',
    [taskId],
  );
  return rows;
}

// 이 작업의 항목 한 건(없으면 null). 다른 작업의 항목 ID 로는 찾지 못한다.
export async function findById(taskId, itemId) {
  const { rows } = await query('SELECT * FROM checklist_items WHERE task_id = $1 AND id = $2', [
    taskId,
    itemId,
  ]);
  return rows[0] ?? null;
}

// 작업 행을 잠근 채 개수를 세므로 동시에 눌러도 상한(50)을 넘지 않는다. 가득 찼으면 null.
export async function insert(taskId, content) {
  return withTransaction(async (client) => {
    await client.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);
    const { rows: stats } = await client.query(
      `SELECT count(*)::int AS n, COALESCE(max(position), 0) AS max
       FROM checklist_items WHERE task_id = $1`,
      [taskId],
    );
    if (stats[0].n >= MAX_ITEMS_PER_TASK) return null;
    const { rows } = await client.query(
      'INSERT INTO checklist_items (task_id, content, position) VALUES ($1, $2, $3) RETURNING *',
      [taskId, content, stats[0].max + POSITION_STEP],
    );
    return rows[0];
  });
}

export async function update(itemId, { content, isDone }) {
  const { rows } = await query(
    `UPDATE checklist_items
        SET content = COALESCE($2, content), is_done = COALESCE($3, is_done)
      WHERE id = $1 RETURNING *`,
    [itemId, content ?? null, isDone ?? null],
  );
  return rows[0];
}

export async function remove(itemId) {
  await query('DELETE FROM checklist_items WHERE id = $1', [itemId]);
}
