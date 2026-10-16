import { query } from '../../config/db.js';

export const RETENTION_DAYS = 90;
export const MAX_PER_PROJECT = 5000;

export const toMessage = (row) =>
  row && {
    id: row.id,
    seq: Number(row.seq),
    body: row.body,
    author: row.author_id ? { id: row.author_id, name: row.author_name } : null,
    createdAt: row.created_at,
  };

const SELECT = `
  SELECT m.*, u.name AS author_name
  FROM chat_messages m
  LEFT JOIN users u ON u.id = m.author_id`;

export async function insert({ projectId, authorId, body }) {
  const { rows } = await query(
    `WITH ins AS (
       INSERT INTO chat_messages (project_id, author_id, body) VALUES ($1, $2, $3) RETURNING *
     )
     SELECT ins.*, u.name AS author_name FROM ins LEFT JOIN users u ON u.id = ins.author_id`,
    [projectId, authorId, body],
  );
  return rows[0];
}

export async function findById(projectId, id) {
  const { rows } = await query(`${SELECT} WHERE m.project_id = $1 AND m.id = $2`, [projectId, id]);
  return rows[0] ?? null;
}

// 최신순. before 는 이전 페이지의 마지막 seq(커서). limit+1 건을 읽어 다음 페이지 유무를 판단한다.
export async function list(projectId, { limit, before }) {
  const params = [projectId, limit + 1];
  let cursor = '';
  if (before !== undefined) {
    params.push(before);
    cursor = 'AND m.seq < $3';
  }
  const { rows } = await query(
    `${SELECT} WHERE m.project_id = $1 ${cursor} ORDER BY m.seq DESC LIMIT $2`,
    params,
  );
  return rows;
}

export async function remove(projectId, id) {
  const { rowCount } = await query('DELETE FROM chat_messages WHERE project_id = $1 AND id = $2', [
    projectId,
    id,
  ]);
  return rowCount > 0;
}

// 프로젝트당 최근 `keep` 건만 남기고 오래된 메시지를 지운다.
export async function trim(projectId, keep) {
  const { rowCount } = await query(
    `DELETE FROM chat_messages
     WHERE project_id = $1
       AND seq < (SELECT seq FROM chat_messages WHERE project_id = $1
                  ORDER BY seq DESC OFFSET $2 LIMIT 1)`,
    [projectId, keep - 1],
  );
  return rowCount;
}

export async function deleteOlderThan(days) {
  const { rowCount } = await query(
    "DELETE FROM chat_messages WHERE created_at < now() - ($1 || ' days')::interval",
    [String(days)],
  );
  return rowCount;
}
