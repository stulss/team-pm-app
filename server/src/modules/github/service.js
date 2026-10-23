import { env } from '../../config/env.js';
import { conflict } from '../../utils/errors.js';
import { emitToProject } from '../../sockets/emitter.js';
import * as projectsRepo from '../projects/repository.js';
import * as tasksRepo from '../tasks/repository.js';
import { assertWritable, create as createTask } from '../tasks/service.js';
import { record } from '../activity/service.js';
import {
  extractClosedIssues,
  extractNumbers,
  extractNumbersFrom,
  prState,
  webhookSecret,
} from './parse.js';
import * as repo from './repository.js';

const MAX_COMMITS_PER_PUSH = 50;

// 소유자에게 보여 줄 연결 정보. 웹훅 비밀은 여기서만 계산해 내려보낸다(저장하지 않는다).
const view = (connection, baseUrl) => ({
  ...repo.toConnection(connection),
  webhookUrl: `${baseUrl}/api/webhooks/github/${connection.id}`,
  secret: webhookSecret(connection, env.JWT_REFRESH_SECRET),
});

export async function getForManager(project, baseUrl) {
  const connection = await repo.getByProject(project.id);
  return { connection: connection ? view(connection, baseUrl) : null };
}

export async function connect(
  project,
  user,
  { repo: fullName, moveOnOpen, doneOnMerge, createOnPr, syncIssues },
  baseUrl,
) {
  assertWritable(project);
  let connection;
  try {
    connection = await repo.upsert({
      projectId: project.id,
      repo: fullName,
      moveOnOpen,
      doneOnMerge,
      createOnPr,
      syncIssues,
      createdBy: user.id,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw conflict('REPO_TAKEN', '이미 다른 프로젝트에 연결된 저장소입니다.');
    }
    throw err;
  }
  await record({
    projectId: project.id,
    actorId: user.id,
    action: 'github.connected',
    meta: { repo: connection.repo },
  });
  return { connection: view(connection, baseUrl) };
}

export async function rotateSecret(project, baseUrl) {
  assertWritable(project);
  const connection = await repo.rotateSecret(project.id);
  if (!connection) throw conflict('NOT_CONNECTED', '연결된 저장소가 없습니다.');
  return { connection: view(connection, baseUrl) };
}

export async function disconnect(project, user) {
  assertWritable(project);
  const connection = await repo.getByProject(project.id);
  if (connection && (await repo.remove(project.id))) {
    await record({
      projectId: project.id,
      actorId: user.id,
      action: 'github.disconnected',
      meta: { repo: connection.repo },
    });
  }
}

export async function listLinks(task) {
  return (await repo.listLinks(task.id)).map(repo.toLink);
}

// ---- 웹훅 처리 ----

// 상태를 자동으로 옮긴다(할 일 → 진행 중, 머지 → 완료). 이미 그 상태면 아무것도 하지 않는다.
async function autoMove(project, taskId, to) {
  const before = await tasksRepo.findById(taskId);
  if (!before || before.status === to) return false;
  await tasksRepo.updateTask(taskId, { status: to }, before);
  await record({
    projectId: project.id,
    taskId,
    actorId: null,
    action: 'task.moved',
    meta: { title: before.title, from: before.status, to, via: 'github' },
  });
  return true;
}

const refOf = (kind, externalId) =>
  kind === 'commit' ? String(externalId).slice(0, 7) : `#${externalId}`;

// 작업에 PR/커밋을 연결(갱신)하고 활동을 남긴다. 연결이 새로 생겼거나 PR 상태가 바뀌면 true.
async function link(project, task, input) {
  const { inserted, prevState } = await repo.upsertLink({
    taskId: task.id,
    projectId: project.id,
    ...input,
  });
  const meta = {
    title: task.title,
    kind: input.kind,
    ref: refOf(input.kind, input.externalId),
    linkTitle: input.title.slice(0, 120),
    url: input.url,
    state: input.state ?? null,
  };
  if (inserted) {
    await record({
      projectId: project.id,
      taskId: task.id,
      actorId: null,
      action: 'github.linked',
      meta,
    });
    return true;
  }
  if (input.kind === 'pull_request' && prevState !== input.state) {
    await record({
      projectId: project.id,
      taskId: task.id,
      actorId: null,
      action: 'github.pr_state',
      meta,
    });
    return true;
  }
  return false;
}

// 바뀐 작업을 실시간으로 알린다(카드의 PR 배지·상태 이동 반영).
async function announce(project, taskId, event = 'task:updated') {
  const row = await tasksRepo.findById(taskId);
  if (row) {
    await emitToProject(null, project.id, event, {
      projectId: project.id,
      task: tasksRepo.toTask(row),
    });
  }
}

const MAX_BODY_CHARS = 9000; // 설명은 1만자까지라 주소를 덧붙일 자리를 남긴다

// PR·이슈 하나를 작업 카드로 만든다. 항목 하나는 한 번만 — 자리(ops.claim)를 먼저 잡아 동시 전달·재오픈에도 안 겹친다.
// 카드를 만들었으면 작업을, 이미 등록했거나(자리 없음) 한도·보관으로 못 만들었으면 null 을 돌려준다.
async function createCard(connection, project, item) {
  const { number, ops } = item;
  if (!(await ops.claim(project.id, number))) return null;
  let task;
  try {
    const assigneeId = item.login
      ? await repo.findMemberByGithubLogin(project.id, item.login)
      : null;
    const body = String(item.body ?? '')
      .trim()
      .slice(0, MAX_BODY_CHARS);
    task = await createTask(
      project,
      { id: connection.created_by ?? project.owner_id },
      {
        title:
          String(item.title ?? '')
            .trim()
            .slice(0, 200) || `${item.label} #${number}`,
        description: [body, `GitHub ${item.label} #${number}: ${item.url ?? ''}`.trim()]
          .filter(Boolean)
          .join('\n\n'),
        status: item.status,
        priority: 'medium',
        assigneeId,
      },
    );
  } catch (err) {
    // 카드를 못 만들었으면 자리를 풀어 나중 이벤트가 다시 시도할 수 있게 한다
    await ops.release(project.id, number);
    if (err.status === 409) return null; // 작업 수 한도·보관된 프로젝트: 등록하지 않는다
    throw err;
  }
  await ops.set(project.id, number, task.id);
  await record({
    projectId: project.id,
    taskId: task.id,
    actorId: null,
    action: 'task.created',
    meta: {
      title: task.title,
      status: task.status,
      via: 'github',
      ...(task.assignee && { assignee: { id: task.assignee.id, name: task.assignee.name } }),
    },
  });
  return task;
}

const PR_CARDS = {
  claim: repo.claimPrCard,
  set: repo.setPrCardTask,
  release: repo.releasePrCard,
};
const ISSUE_CARDS = {
  claim: repo.claimIssueCard,
  set: repo.setIssueCardTask,
  release: repo.releaseIssueCard,
};

const createCardFromPr = (connection, project, pr) =>
  createCard(connection, project, {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    url: pr.html_url,
    label: 'PR',
    login: pr.user?.login,
    status: connection.move_on_open ? 'in_progress' : 'todo',
    ops: PR_CARDS,
  });

async function handlePullRequest(connection, project, payload) {
  const pr = payload.pull_request;
  if (!pr?.number) return { ignored: 'pull_request' };
  const state = prState(pr);
  const numbers = extractNumbersFrom([pr.title, pr.body, pr.head?.ref], project.key);
  const tasks = await repo.findTasksByNumbers(project.id, numbers);
  // "closes #N" 으로 적은 이슈의 카드도 이 PR 에 연결한다(M43)
  const closing = await repo.findTasksByIssueNumbers(
    project.id,
    extractClosedIssues([pr.title, pr.body], connection.repo),
  );
  for (const task of closing) {
    if (!tasks.some((t) => t.id === task.id)) tasks.push(task);
  }
  const opened =
    ['opened', 'reopened', 'ready_for_review'].includes(payload.action) && state === 'open';
  const merged = payload.action === 'closed' && state === 'merged';

  let created = 0;
  if (
    connection.create_on_pr &&
    closing.length === 0 && // 닫으려는 이슈 카드가 있으면 그 카드에 연결하면 된다
    numbers.length === 0 && // 작업 키가 있는 PR 은 그 작업에 연결하는 것이 맞다(오타여도 새로 만들지 않는다)
    opened &&
    project.status === 'active' &&
    pr.user?.type !== 'Bot'
  ) {
    const card = await createCardFromPr(connection, project, pr);
    if (card) {
      tasks.push({ id: card.id, number: card.number, title: card.title, status: card.status });
      created = 1;
    }
  }

  let linked = 0;
  let moved = 0;
  for (const task of tasks) {
    const changed = await link(project, task, {
      kind: 'pull_request',
      externalId: String(pr.number),
      title: pr.title ?? `PR #${pr.number}`,
      url: pr.html_url ?? '',
      state,
      author: pr.user?.login,
    });
    if (changed) linked += 1;
    if (project.status === 'active') {
      if (connection.move_on_open && opened && task.status === 'todo') {
        if (await autoMove(project, task.id, 'in_progress')) moved += 1;
      }
      if (connection.done_on_merge && merged) {
        if (await autoMove(project, task.id, 'done')) moved += 1;
      }
    }
    // 새로 만든 카드는 다른 화면에 아직 없으므로 created 로 알린다(PR 배지까지 붙은 모양으로)
    await announce(
      project,
      task.id,
      created && task.id === tasks.at(-1).id ? 'task:created' : 'task:updated',
    );
  }
  return { tasks: tasks.length, linked, moved, created };
}

// 이슈 → 카드(옵션 syncIssues). 한 방향(GitHub → 앱): 열면 만들고, 닫으면 완료, 다시 열면 할 일, 제목이 바뀌면 따라 바꾼다.
async function handleIssue(connection, project, payload) {
  const issue = payload.issue;
  if (!issue?.number || issue.pull_request) return { ignored: 'issue' }; // PR 은 pull_request 이벤트로 다룬다
  if (!connection.sync_issues) return { ignored: 'issues' };
  const action = payload.action;
  if (!['opened', 'reopened', 'closed', 'edited'].includes(action)) return { ignored: 'issues' };

  const numbers = extractNumbersFrom([issue.title, issue.body], project.key);
  const keyed = await repo.findTasksByNumbers(project.id, numbers);
  const open = issue.state === 'open';
  let taskId = await repo.getIssueCardTaskId(project.id, issue.number);
  let created = 0;
  let moved = 0;

  if (!taskId && numbers.length === 0 && open && ['opened', 'reopened'].includes(action)) {
    if (project.status === 'active' && issue.user?.type !== 'Bot') {
      const card = await createCard(connection, project, {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        url: issue.html_url,
        label: '이슈',
        login: issue.assignees?.[0]?.login ?? issue.assignee?.login,
        status: 'todo',
        ops: ISSUE_CARDS,
      });
      if (card) {
        taskId = card.id;
        created = 1;
      }
    }
  }

  // 키가 있는 이슈는 그 작업에 링크만 건다(상태는 건드리지 않는다)
  const targets = [...keyed];
  if (taskId && !targets.some((t) => t.id === taskId)) {
    targets.push({ id: taskId, title: issue.title });
  }
  const state = open ? 'open' : 'closed';
  for (const task of targets) {
    await link(project, task, {
      kind: 'issue',
      externalId: String(issue.number),
      title: issue.title ?? `이슈 #${issue.number}`,
      url: issue.html_url ?? '',
      state,
      author: issue.user?.login,
    });
  }

  if (taskId && project.status === 'active') {
    const row = await tasksRepo.findById(taskId);
    if (row) {
      if (action === 'closed' && (await autoMove(project, taskId, 'done'))) moved += 1;
      if (action === 'reopened' && row.status === 'done') {
        if (await autoMove(project, taskId, 'todo')) moved += 1;
      }
      const title = String(issue.title ?? '')
        .trim()
        .slice(0, 200);
      if (action === 'edited' && title && title !== row.title) {
        await tasksRepo.updateTask(taskId, { title }, row);
        await record({
          projectId: project.id,
          taskId,
          actorId: null,
          action: 'task.updated',
          meta: { title, changes: { title: { from: row.title, to: title } }, via: 'github' },
        });
      }
    }
  }
  for (const task of targets) {
    await announce(
      project,
      task.id,
      created && task.id === taskId ? 'task:created' : 'task:updated',
    );
  }
  return { tasks: targets.length, created, moved };
}

async function handlePush(project, payload) {
  if (payload.deleted) return { ignored: 'deleted' };
  const commits = (payload.commits ?? []).slice(0, MAX_COMMITS_PER_PUSH);
  let linked = 0;
  const touched = new Set();
  for (const commit of commits) {
    const numbers = extractNumbers(commit.message, project.key);
    if (numbers.length === 0 || !commit.id) continue;
    const tasks = await repo.findTasksByNumbers(project.id, numbers);
    for (const task of tasks) {
      const changed = await link(project, task, {
        kind: 'commit',
        externalId: commit.id,
        title: String(commit.message).split('\n')[0] || commit.id.slice(0, 7),
        url: commit.url ?? '',
        state: null,
        author: commit.author?.username ?? commit.author?.name,
      });
      if (changed) linked += 1;
      touched.add(task.id);
    }
  }
  for (const id of touched) await announce(project, id);
  return { tasks: touched.size, linked };
}

// 서명이 검증된 전달 하나를 처리한다. 반환값은 응답 본문(status 가 있으면 그 상태로 답한다).
export async function handleWebhook(connection, event, payload) {
  if (event === 'ping') return { pong: true };
  if (!['pull_request', 'push', 'issues'].includes(event)) return { ignored: event };

  const fullName = payload?.repository?.full_name;
  if (!fullName || fullName.toLowerCase() !== connection.repo.toLowerCase()) {
    return { ignored: 'repository', status: 202 };
  }
  const project = await projectsRepo.findById(connection.project_id);
  if (!project) return { ignored: 'project', status: 202 };

  const handlers = {
    pull_request: () => handlePullRequest(connection, project, payload),
    push: () => handlePush(project, payload),
    issues: () => handleIssue(connection, project, payload),
  };
  const result = await handlers[event]();
  await repo.touch(connection.id);
  return result;
}
