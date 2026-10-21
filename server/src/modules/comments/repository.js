import { query, withTransaction } from '../../config/db.js';

export const DELETED_BODY = '삭제된 댓글';

export const toComment = (row) =>
  row && {
    id: row.id,
    taskId: row.task_id,
    author: { id: row.author_id, name: row.author_name },
    // 삭제된 댓글은 본문을 가린다.
    body: row.deleted_at ? DELETED_BODY : row.body,
    mentions: row.deleted_at ? [] : (row.mentions ?? []),
    reactions: row.deleted_at ? [] : (row.reactions ?? []),
    deleted: Boolean(row.deleted_at),
    edited: !row.deleted_at && new Date(row.updated_at) > new Date(row.created_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const SELECT = `
  SELECT c.*, u.name AS author_name, t.project_id, t.title AS task_title,
         COALESCE(
           (SELECT json_agg(json_build_object('id', cm.user_id, 'name', cm.name)
                            ORDER BY cm.created_at, cm.user_id)
            FROM comment_mentions cm WHERE cm.comment_id = c.id),
           '[]'::json) AS mentions,
         COALESCE(
           (SELECT json_agg(json_build_object('key', g.emoji, 'users', g.users) ORDER BY g.first_at)
            FROM (SELECT r.emoji, min(r.created_at) AS first_at,
                         json_agg(json_build_object('id', ru.id, 'name', ru.name)
                                  ORDER BY r.created_at, ru.id) AS users
                  FROM comment_reactions r JOIN users ru ON ru.id = r.user_id
                  WHERE r.comment_id = c.id GROUP BY r.emoji) g),
           '[]'::json) AS reactions
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

// 프로젝트의 활성 멤버만 돌려준다. 멘션 대상 검증과 이름 스냅샷에 쓴다.
export async function memberNames(projectId, userIds) {
  if (userIds.length === 0) return [];
  const { rows } = await query(
    `SELECT u.id, u.name FROM users u
     JOIN project_members m ON m.user_id = u.id AND m.project_id = $1
     WHERE u.id = ANY($2::uuid[]) AND u.is_active`,
    [projectId, userIds],
  );
  return rows;
}

async function insertMentions(client, commentId, mentions) {
  if (mentions.length === 0) return;
  await client.query(
    `INSERT INTO comment_mentions (comment_id, user_id, name)
     SELECT $1, * FROM unnest($2::uuid[], $3::text[])`,
    [commentId, mentions.map((m) => m.id), mentions.map((m) => m.name)],
  );
}

// 댓글과 멘션을 한 트랜잭션으로 저장한다. mentions: [{ id, name }]
export async function insertComment({ taskId, authorId, body, mentions = [] }) {
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id',
      [taskId, authorId, body],
    );
    await insertMentions(client, rows[0].id, mentions);
    return rows[0].id;
  });
  return findById(id);
}

// 삭제된 댓글은 수정할 수 없다(갱신되는 행이 없으면 null). 멘션은 통째로 교체한다.
export async function updateBody(id, body, mentions = []) {
  const updated = await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      'UPDATE comments SET body = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [id, body],
    );
    if (rowCount !== 1) return false;
    await client.query('DELETE FROM comment_mentions WHERE comment_id = $1', [id]);
    await insertMentions(client, id, mentions);
    return true;
  });
  return updated ? findById(id) : null;
}

export async function softDelete(id) {
  const { rowCount } = await query(
    'UPDATE comments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return rowCount === 1;
}

// 반응을 달거나(on) 거둔다. 이미 있는 반응을 다시 달아도 그대로다(멱등).
export async function setReaction(commentId, userId, emoji, on) {
  if (on) {
    await query(
      `INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [commentId, userId, emoji],
    );
  } else {
    await query(
      'DELETE FROM comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3',
      [commentId, userId, emoji],
    );
  }
}
