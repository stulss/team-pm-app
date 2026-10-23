import { query } from '../../config/db.js';

export const toConnection = (row) =>
  row && {
    id: row.id,
    projectId: row.project_id,
    repo: row.repo,
    moveOnOpen: row.move_on_open,
    doneOnMerge: row.done_on_merge,
    createOnPr: row.create_on_pr,
    syncIssues: row.sync_issues,
    lastEventAt: row.last_event_at,
  };

export const toLink = (row) => ({
  id: row.id,
  kind: row.kind,
  externalId: row.external_id,
  title: row.title,
  url: row.url,
  state: row.state,
  author: row.author,
  updatedAt: row.updated_at,
});

export async function getByProject(projectId) {
  const { rows } = await query('SELECT * FROM github_connections WHERE project_id = $1', [
    projectId,
  ]);
  return rows[0] ?? null;
}

export async function getById(id) {
  const { rows } = await query('SELECT * FROM github_connections WHERE id = $1', [id]);
  return rows[0] ?? null;
}

// 프로젝트당 하나: 있으면 저장소·옵션을 바꾸고 없으면 만든다. 저장소가 다른 프로젝트에 이미 연결돼 있으면 23505.
export async function upsert({
  projectId,
  repo,
  moveOnOpen,
  doneOnMerge,
  createOnPr,
  syncIssues,
  createdBy,
}) {
  const { rows } = await query(
    `INSERT INTO github_connections
       (project_id, repo, move_on_open, done_on_merge, create_on_pr, sync_issues, created_by)
     VALUES ($1, $2, COALESCE($3, false), COALESCE($4, false), COALESCE($5, false),
             COALESCE($6, false), $7)
     ON CONFLICT (project_id) DO UPDATE
       SET repo = EXCLUDED.repo,
           move_on_open = COALESCE($3, github_connections.move_on_open),
           done_on_merge = COALESCE($4, github_connections.done_on_merge),
           create_on_pr = COALESCE($5, github_connections.create_on_pr),
           sync_issues = COALESCE($6, github_connections.sync_issues)
     RETURNING *`,
    [
      projectId,
      repo,
      moveOnOpen ?? null,
      doneOnMerge ?? null,
      createOnPr ?? null,
      syncIssues ?? null,
      createdBy,
    ],
  );
  return rows[0];
}

export async function rotateSecret(projectId) {
  const { rows } = await query(
    'UPDATE github_connections SET secret_version = secret_version + 1 WHERE project_id = $1 RETURNING *',
    [projectId],
  );
  return rows[0] ?? null;
}

export async function remove(projectId) {
  const { rowCount } = await query('DELETE FROM github_connections WHERE project_id = $1', [
    projectId,
  ]);
  return rowCount === 1;
}

export async function touch(id) {
  await query('UPDATE github_connections SET last_event_at = now() WHERE id = $1', [id]);
}

// 이 전달을 처음 받으면 true(기록함), 이미 처리한 전달이면 false.
export async function claimDelivery(deliveryId, connectionId) {
  const { rowCount } = await query(
    `INSERT INTO github_deliveries (delivery_id, connection_id) VALUES ($1, $2)
     ON CONFLICT (delivery_id) DO NOTHING`,
    [deliveryId, connectionId],
  );
  return rowCount === 1;
}

export async function deleteOldDeliveries(days) {
  const { rowCount } = await query(
    "DELETE FROM github_deliveries WHERE received_at < now() - ($1 || ' days')::interval",
    [String(days)],
  );
  return rowCount;
}

// 프로젝트 안에서 번호로 작업을 찾는다.
export async function findTasksByNumbers(projectId, numbers) {
  if (numbers.length === 0) return [];
  const { rows } = await query(
    'SELECT id, number, title, status FROM tasks WHERE project_id = $1 AND number = ANY($2::int[])',
    [projectId, numbers],
  );
  return rows;
}

// 이슈 번호에 해당하는 작업(이슈로 만든 카드, 또는 작업 키 이슈가 연결된 작업)을 찾는다(M43).
export async function findTasksByIssueNumbers(projectId, numbers) {
  if (numbers.length === 0) return [];
  const { rows } = await query(
    `SELECT DISTINCT t.id, t.number, t.title, t.status
     FROM tasks t
     WHERE t.project_id = $1 AND (
       t.id IN (SELECT task_id FROM github_issue_cards
                WHERE project_id = $1 AND issue_number = ANY($2::int[]) AND task_id IS NOT NULL)
       OR t.id IN (SELECT task_id FROM github_task_links
                   WHERE project_id = $1 AND kind = 'issue' AND external_id = ANY($3::text[]))
     )`,
    [projectId, numbers, numbers.map(String)],
  );
  return rows;
}

// ---- PR → 작업 카드 자동 등록 (M34) ----

// PR 하나의 등록 자리를 잡는다. 처음이면 true, 이미 등록했거나 다른 전달이 먼저 잡았으면 false.
export async function claimPrCard(projectId, prNumber) {
  const { rowCount } = await query(
    `INSERT INTO github_pr_cards (project_id, pr_number) VALUES ($1, $2)
     ON CONFLICT (project_id, pr_number) DO NOTHING`,
    [projectId, prNumber],
  );
  return rowCount === 1;
}

export async function setPrCardTask(projectId, prNumber, taskId) {
  await query('UPDATE github_pr_cards SET task_id = $3 WHERE project_id = $1 AND pr_number = $2', [
    projectId,
    prNumber,
    taskId,
  ]);
}

// 카드를 만들지 못했을 때 자리를 풀어, 나중 이벤트가 다시 시도할 수 있게 한다.
export async function releasePrCard(projectId, prNumber) {
  await query('DELETE FROM github_pr_cards WHERE project_id = $1 AND pr_number = $2', [
    projectId,
    prNumber,
  ]);
}

// ---- 이슈 동기화 (M35): PR 카드와 같은 방식으로 이슈 하나를 한 번만 등록한다 ----

export async function claimIssueCard(projectId, issueNumber) {
  const { rowCount } = await query(
    `INSERT INTO github_issue_cards (project_id, issue_number) VALUES ($1, $2)
     ON CONFLICT (project_id, issue_number) DO NOTHING`,
    [projectId, issueNumber],
  );
  return rowCount === 1;
}

export async function setIssueCardTask(projectId, issueNumber, taskId) {
  await query(
    'UPDATE github_issue_cards SET task_id = $3 WHERE project_id = $1 AND issue_number = $2',
    [projectId, issueNumber, taskId],
  );
}

export async function releaseIssueCard(projectId, issueNumber) {
  await query('DELETE FROM github_issue_cards WHERE project_id = $1 AND issue_number = $2', [
    projectId,
    issueNumber,
  ]);
}

// 이슈에 연결된 카드의 id. 등록한 적이 없거나 카드를 지웠으면 null.
export async function getIssueCardTaskId(projectId, issueNumber) {
  const { rows } = await query(
    'SELECT task_id FROM github_issue_cards WHERE project_id = $1 AND issue_number = $2',
    [projectId, issueNumber],
  );
  return rows[0]?.task_id ?? null;
}

// GitHub 로그인 이름이 같은 활성 프로젝트 멤버(대소문자 무시). 없으면 null.
export async function findMemberByGithubLogin(projectId, login) {
  const { rows } = await query(
    `SELECT u.id FROM users u
     JOIN project_members m ON m.user_id = u.id AND m.project_id = $1
     WHERE lower(u.github_login) = lower($2) AND u.is_active
     LIMIT 1`,
    [projectId, login],
  );
  return rows[0]?.id ?? null;
}

// 같은 (작업, 종류, 외부 id) 는 한 행으로 갱신한다. 새로 만들었는지(inserted)와 이전 상태(prevState)를 돌려준다.
export async function upsertLink({
  taskId,
  projectId,
  kind,
  externalId,
  title,
  url,
  state,
  author,
}) {
  const { rows } = await query(
    `WITH prev AS (
       SELECT state FROM github_task_links WHERE task_id = $1 AND kind = $3 AND external_id = $4
     )
     INSERT INTO github_task_links (task_id, project_id, kind, external_id, title, url, state, author)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (task_id, kind, external_id) DO UPDATE
       SET title = EXCLUDED.title, url = EXCLUDED.url, state = EXCLUDED.state,
           author = COALESCE(EXCLUDED.author, github_task_links.author), updated_at = now()
     RETURNING id, (xmax = 0) AS inserted, (SELECT state FROM prev) AS prev_state`,
    [
      taskId,
      projectId,
      kind,
      externalId,
      title.slice(0, 300),
      url.slice(0, 500),
      state ?? null,
      author ?? null,
    ],
  );
  return { id: rows[0].id, inserted: rows[0].inserted, prevState: rows[0].prev_state };
}

export async function listLinks(taskId) {
  const { rows } = await query(
    'SELECT * FROM github_task_links WHERE task_id = $1 ORDER BY updated_at DESC, id',
    [taskId],
  );
  return rows;
}
