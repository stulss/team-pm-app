import { query, withTransaction } from '../../config/db.js';

export const MAX_LABELS_PER_PROJECT = 20;
export const MAX_LABELS_PER_TASK = 10;
export const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'];

export const toLabel = (row) =>
  row && { id: row.id, name: row.name, color: row.color, createdBy: row.created_by ?? null };

const isDuplicate = (err) => err.code === '23505';

export async function list(projectId) {
  const { rows } = await query(
    'SELECT id, name, color, created_by FROM labels WHERE project_id = $1 ORDER BY lower(name)',
    [projectId],
  );
  return rows;
}

export async function countByProject(projectId) {
  const { rows } = await query('SELECT count(*)::int AS n FROM labels WHERE project_id = $1', [
    projectId,
  ]);
  return rows[0].n;
}

// 이 프로젝트의 라벨 한 건(없으면 null). 다른 프로젝트의 라벨 ID 로는 찾지 못한다.
export async function findById(projectId, labelId) {
  const { rows } = await query('SELECT * FROM labels WHERE project_id = $1 AND id = $2', [
    projectId,
    labelId,
  ]);
  return rows[0] ?? null;
}

// 같은 이름(대소문자 무시)이 이미 있으면 null.
export async function insert({ projectId, name, color, createdBy }) {
  try {
    const { rows } = await query(
      `INSERT INTO labels (project_id, name, color, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id, name, color, created_by`,
      [projectId, name, color, createdBy],
    );
    return rows[0];
  } catch (err) {
    if (isDuplicate(err)) return null;
    throw err;
  }
}

// 바꿀 이름이 다른 라벨과 겹치면 null.
export async function update(labelId, { name, color }) {
  try {
    const { rows } = await query(
      `UPDATE labels SET name = COALESCE($2, name), color = COALESCE($3, color)
       WHERE id = $1 RETURNING id, name, color, created_by`,
      [labelId, name ?? null, color ?? null],
    );
    return rows[0];
  } catch (err) {
    if (isDuplicate(err)) return null;
    throw err;
  }
}

export async function remove(labelId) {
  await query('DELETE FROM labels WHERE id = $1', [labelId]);
}

// 이 프로젝트에 실제로 있는 라벨 ID 만 돌려준다.
export async function existingIds(projectId, labelIds) {
  if (labelIds.length === 0) return [];
  const { rows } = await query(
    'SELECT id FROM labels WHERE project_id = $1 AND id = ANY($2::uuid[])',
    [projectId, labelIds],
  );
  return rows.map((r) => r.id);
}

// 작업의 라벨을 통째로 바꾼다. 작업 행을 잠가 같은 작업의 동시 변경을 직렬화한다.
export async function setTaskLabels(task, labelIds) {
  await withTransaction(async (client) => {
    await client.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [task.id]);
    await client.query('DELETE FROM task_labels WHERE task_id = $1', [task.id]);
    for (const labelId of labelIds) {
      await client.query(
        'INSERT INTO task_labels (task_id, label_id, project_id) VALUES ($1, $2, $3)',
        [task.id, labelId, task.project_id],
      );
    }
  });
}
