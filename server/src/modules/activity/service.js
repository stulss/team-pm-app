import { logger } from '../../utils/logger.js';
import { emitToProject } from '../../sockets/emitter.js';
import * as repo from './repository.js';

// 활동 기록은 부가 기능이다. 저장에 실패해도 본 요청은 실패시키지 않고 로그만 남긴다.
// 저장이 끝난 뒤 `activity:created` 를 프로젝트 방 전체(요청자 포함)에 보내 목록을 다시 불러오게 한다.
// 작업·댓글 이벤트와 따로 보내는 이유: 그 이벤트를 느리게 만들지 않으면서, 클라이언트가 기록이 저장되기
// 전에 목록을 불러와 빈손으로 돌아오는 경쟁을 없애기 위해서다.
export async function record(input) {
  try {
    await repo.insert(input);
  } catch (err) {
    logger.warn({ err: err.message, action: input.action }, 'activity record failed');
    return;
  }
  await emitToProject(null, input.projectId, 'activity:created', {
    projectId: input.projectId,
    taskId: input.taskId ?? null,
  });
}

export async function list(projectId, { limit, before, taskId, action, excludeActions }) {
  const rows = await repo.list(projectId, { limit, before, taskId, action, excludeActions });
  const page = rows.slice(0, limit);
  return {
    data: page.map(repo.toActivity),
    nextCursor: rows.length > limit ? Number(page[page.length - 1].seq) : null,
  };
}

const norm = (v) => (v === undefined || v === '' ? null : v);

// 수정 전(DB 행)과 수정 후(응답 모양)를 비교해 바뀐 항목만 { from, to } 로 돌려준다.
export function taskChanges(before, after) {
  const changes = {};
  const diff = (key, from, to) => {
    if (norm(from) !== norm(to)) changes[key] = { from: norm(from), to: norm(to) };
  };
  diff('title', before.title, after.title);
  diff('status', before.status, after.status);
  diff('priority', before.priority, after.priority);
  diff('dueDate', before.due_date, after.dueDate);
  if ((before.assignee_id ?? null) !== (after.assignee?.id ?? null)) {
    changes.assignee = {
      from: before.assignee_id ? { id: before.assignee_id, name: before.assignee_name } : null,
      to: after.assignee ? { id: after.assignee.id, name: after.assignee.name } : null,
    };
  }
  // 설명은 내용을 기록하지 않고 바뀌었다는 사실만 남긴다.
  if (norm(before.description) !== norm(after.description)) changes.description = true;
  return changes;
}

export const recordTaskCreated = ({ project, task, actor }) =>
  record({
    projectId: project.id,
    taskId: task.id,
    actorId: actor.id,
    action: 'task.created',
    meta: {
      title: task.title,
      status: task.status,
      ...(task.assignee && { assignee: { id: task.assignee.id, name: task.assignee.name } }),
    },
  });

export async function recordTaskUpdated({ project, before, after, actor }) {
  const changes = taskChanges(before, after);
  if (Object.keys(changes).length === 0) return;
  await record({
    projectId: project.id,
    taskId: after.id,
    actorId: actor.id,
    action: 'task.updated',
    meta: { title: after.title, changes },
  });
}

// 컬럼(상태)이 바뀐 이동만 기록한다. 같은 컬럼 안의 순서 변경은 기록하지 않는다.
export async function recordTaskMoved({ project, before, after, actor }) {
  if (before.status === after.status) return;
  await record({
    projectId: project.id,
    taskId: after.id,
    actorId: actor.id,
    action: 'task.moved',
    meta: { title: after.title, from: before.status, to: after.status },
  });
}
