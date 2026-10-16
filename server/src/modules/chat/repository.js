import { query, withTransaction } from '../../config/db.js';

export const RETENTION_DAYS = 90;
export const MAX_PER_PROJECT = 5000;

export const toMessage = (row) =>
  row && {
    id: row.id,
    seq: Number(row.seq),
    body: row.body,
    author: row.author_id ? { id: row.author_id, name: row.author_name } : null,
    mentions: row.mentions ?? [],
    createdAt: row.created_at,
  };

const SELECT = `
  SELECT m.*, u.name AS author_name,
         COALESCE(
           (SELECT json_agg(json_build_object('id', cm.user_id, 'name', cm.name)
                            ORDER BY cm.created_at, cm.user_id)
            FROM chat_message_mentions cm WHERE cm.message_id = m.id),
           '[]'::json) AS mentions
  FROM chat_messages m
  LEFT JOIN users u ON u.id = m.author_id`;

// 메시지와 멘션을 한 트랜잭션으로 저장한다. mentions: [{ id, name }]
export async function insert({ projectId, authorId, body, mentions = [] }) {
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO chat_messages (project_id, author_id, body) VALUES ($1, $2, $3) RETURNING id',
      [projectId, authorId, body],
    );
    if (mentions.length > 0) {
      await client.query(
        `INSERT INTO chat_message_mentions (message_id, user_id, name)
         SELECT $1, * FROM unnest($2::uuid[], $3::text[])`,
        [rows[0].id, mentions.map((m) => m.id), mentions.map((m) => m.name)],
      );
    }
    return rows[0].id;
  });
  return findById(projectId, id);
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
