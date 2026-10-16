import { query, withTransaction } from '../../config/db.js';

export const MAX_POLLS_PER_PROJECT = 100;

export async function countByProject(projectId) {
  const { rows } = await query('SELECT count(*)::int AS n FROM polls WHERE project_id = $1', [
    projectId,
  ]);
  return rows[0].n;
}

export async function insertPoll({ projectId, createdBy, question, multiple, options }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO polls (project_id, created_by, question, multiple)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [projectId, createdBy, question, multiple],
    );
    const pollId = rows[0].id;
    for (const [position, label] of options.entries()) {
      await client.query(
        'INSERT INTO poll_options (poll_id, label, position) VALUES ($1, $2, $3)',
        [pollId, label, position],
      );
    }
    return pollId;
  });
}

// 이 프로젝트의 투표 한 건(없으면 null). 다른 프로젝트의 투표 ID 로는 찾지 못한다.
export async function findById(projectId, pollId) {
  const { rows } = await query('SELECT * FROM polls WHERE project_id = $1 AND id = $2', [
    projectId,
    pollId,
  ]);
  return rows[0] ?? null;
}

export async function optionIds(pollId) {
  const { rows } = await query('SELECT id FROM poll_options WHERE poll_id = $1', [pollId]);
  return rows.map((r) => r.id);
}

// 단일 선택의 "1인 1표"를 보장한다: 투표 행을 잠근 트랜잭션에서 내 표를 모두 지우고 새로 넣는다.
// 잠금 덕분에 같은 사람이 동시에 두 번 보내도 한 표만 남고, 마감과 겹쳐도 마감 후에는 표가 들어가지 않는다.
// 마감됐으면 false, 저장했으면 true.
export async function setVotes(pollId, userId, optionIds) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT closed_at FROM polls WHERE id = $1 FOR UPDATE', [
      pollId,
    ]);
    if (!rows[0] || rows[0].closed_at) return false;
    await client.query('DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [
      pollId,
      userId,
    ]);
    for (const optionId of optionIds) {
      await client.query(
        'INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3)',
        [pollId, optionId, userId],
      );
    }
    return true;
  });
}

export async function close(pollId) {
  const { rowCount } = await query(
    'UPDATE polls SET closed_at = now() WHERE id = $1 AND closed_at IS NULL',
    [pollId],
  );
  return rowCount > 0;
}

export async function remove(pollId) {
  await query('DELETE FROM polls WHERE id = $1', [pollId]);
}

// 집계는 "지금 프로젝트 멤버"의 표만 센다. 응답에는 누가 투표했는지가 들어가지 않는다(익명 집계).
export async function list(projectId, userId, { pollId = null, limit = 50 } = {}) {
  const filter = pollId ? 'AND p.id = $2' : '';
  const polls = (
    await query(
      `SELECT p.*, u.name AS creator_name
       FROM polls p LEFT JOIN users u ON u.id = p.created_by
       WHERE p.project_id = $1 ${filter}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ${pollId ? 1 : Number(limit)}`,
      pollId ? [projectId, pollId] : [projectId],
    )
  ).rows;
  if (polls.length === 0) return [];
  const ids = polls.map((p) => p.id);

  const options = (
    await query(
      `SELECT o.poll_id, o.id, o.label, count(pm.user_id)::int AS votes
       FROM poll_options o
       LEFT JOIN poll_votes v ON v.option_id = o.id
       LEFT JOIN project_members pm ON pm.project_id = $1 AND pm.user_id = v.user_id
       WHERE o.poll_id = ANY($2::uuid[])
       GROUP BY o.id ORDER BY o.poll_id, o.position`,
      [projectId, ids],
    )
  ).rows;
  const voters = (
    await query(
      `SELECT v.poll_id, count(DISTINCT v.user_id)::int AS n
       FROM poll_votes v
       JOIN project_members pm ON pm.project_id = $1 AND pm.user_id = v.user_id
       WHERE v.poll_id = ANY($2::uuid[]) GROUP BY v.poll_id`,
      [projectId, ids],
    )
  ).rows;
  const mine = (
    await query(
      'SELECT poll_id, option_id FROM poll_votes WHERE user_id = $1 AND poll_id = ANY($2::uuid[])',
      [userId, ids],
    )
  ).rows;
  return assemble(polls, options, voters, mine);
}

export function assemble(polls, options, voters, mine) {
  return polls.map((p) => ({
    id: p.id,
    question: p.question,
    multiple: p.multiple,
    closed: Boolean(p.closed_at),
    closedAt: p.closed_at,
    createdBy: p.created_by ? { id: p.created_by, name: p.creator_name } : null,
    createdAt: p.created_at,
    options: options
      .filter((o) => o.poll_id === p.id)
      .map((o) => ({ id: o.id, label: o.label, votes: o.votes })),
    totalVoters: voters.find((v) => v.poll_id === p.id)?.n ?? 0,
    myVotes: mine.filter((m) => m.poll_id === p.id).map((m) => m.option_id),
  }));
}
