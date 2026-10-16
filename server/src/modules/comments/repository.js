import { query } from '../../config/db.js';

export const DELETED_BODY = '삭제된 댓글';

export const toComment = (row) =>
  row && {
    id: row.id,
    taskId: row.task_id,
    author: { id: row.author_id, name: row.author_name },
    // 삭제된 댓글은 본문을 가린다.
    body: row.deleted_at ? DELETED_BODY : row.body,
    deleted: Boolean(row.deleted_at),
    edited: !row.deleted_at && new Date(row.updated_at) > new Date(row.created_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const SELECT = `
  SELECT c.*, u.name AS author_name, t.project_id, t.title AS task_title
  FROM comments c
  JOIN users u ON u.id = c.author_id
  JOIN tasks t ON t.id = c.task_id`;

export async function findById(id) {
  const { rows } = await query(`${SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listByTask(taskId) {
  const { rows } = await query(
    `${SELECT} WHERE c.task_id = $1 ORDER BY c.created_at ASC, c.id ASC`,
    [taskId],
  );
  return rows;
}

export async function insertComment({ taskId, authorId, body }) {
  const { rows } = await query(
    'INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id',
    [taskId, authorId, body],
  );
  return findById(rows[0].id);
}

// 삭제된 댓글은 수정할 수 없다(갱신되는 행이 없으면 null).
export async function updateBody(id, body) {
  const { rowCount } = await query(
    'UPDATE comments SET body = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id, body],
  );
  return rowCount === 1 ? findById(id) : null;
}

export async function softDelete(id) {
  const { rowCount } = await query(
    'UPDATE comments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return rowCount === 1;
}
