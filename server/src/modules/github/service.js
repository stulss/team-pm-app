import { env } from '../../config/env.js';
import { conflict } from '../../utils/errors.js';
import { emitToProject } from '../../sockets/emitter.js';
import * as projectsRepo from '../projects/repository.js';
import * as tasksRepo from '../tasks/repository.js';
import { assertWritable, create as createTask } from '../tasks/service.js';
import { record } from '../activity/service.js';
import { extractNumbers, extractNumbersFrom, prState, webhookSecret } from './parse.js';
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
  { repo: fullName, moveOnOpen, doneOnMerge, createOnPr },
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
  kind === 'pull_request' ? `#${externalId}` : String(externalId).slice(0, 7);

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

const MAX_BODY_CHARS = 9000; // 설명은 1만자까지라 PR 주소를 덧붙일 자리를 남긴다

// 키 없는 PR 을 작업 카드로 만든다(옵션 createOnPr). PR 하나는 한 번만 — 자리를 먼저 잡아 동시 전달·재오픈에도 안 겹친다.
async function createCardFromPr(connection, project, pr) {
  if (!(await repo.claimPrCard(project.id, pr.number))) return null;
  let task;
  try {
    const login = pr.user?.login;
    const assigneeId = login ? await repo.findMemberByGithubLogin(project.id, login) : null;
    const body = String(pr.body ?? '')
      .trim()
      .slice(0, MAX_BODY_CHARS);
    task = await createTask(
      project,
      { id: connection.created_by ?? project.owner_id },
      {
        title:
          String(pr.title ?? '')
            .trim()
            .slice(0, 200) || `PR #${pr.number}`,
        description: [body, `GitHub PR #${pr.number}: ${pr.html_url ?? ''}`.trim()]
          .filter(Boolean)
          .join('\n\n'),
        status: connection.move_on_open ? 'in_progress' : 'todo',
        priority: 'medium',
        assigneeId,
      },
    );
  } catch (err) {
    // 카드를 못 만들었으면 자리를 풀어 나중 이벤트가 다시 시도할 수 있게 한다
    await repo.releasePrCard(project.id, pr.number);
    if (err.status === 409) return null; // 작업 수 한도·보관된 프로젝트: 등록하지 않는다
    throw err;
  }
  await repo.setPrCardTask(project.id, pr.number, task.id);
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

async function handlePullRequest(connection, project, payload) {
  const pr = payload.pull_request;
  if (!pr?.number) return { ignored: 'pull_request' };
  const state = prState(pr);
  const numbers = extractNumbersFrom([pr.title, pr.body, pr.head?.ref], project.key);
  const tasks = await repo.findTasksByNumbers(project.id, numbers);
  const opened =
    ['opened', 'reopened', 'ready_for_review'].includes(payload.action) && state === 'open';
  const merged = payload.action === 'closed' && state === 'merged';

  let created = 0;
  if (
    connection.create_on_pr &&
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
  if (event !== 'pull_request' && event !== 'push') return { ignored: event };

  const fullName = payload?.repository?.full_name;
  if (!fullName || fullName.toLowerCase() !== connection.repo.toLowerCase()) {
    return { ignored: 'repository', status: 202 };
  }
  const project = await projectsRepo.findById(connection.project_id);
  if (!project) return { ignored: 'project', status: 202 };

  const result =
    event === 'pull_request'
      ? await handlePullRequest(connection, project, payload)
      : await handlePush(project, payload);
  await repo.touch(connection.id);
  return result;
}
