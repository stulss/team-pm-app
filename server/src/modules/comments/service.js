import { AppError, forbidden, notFound } from '../../utils/errors.js';
import { assertWritable } from '../tasks/service.js';
import * as repo from './repository.js';

// 수정은 작성자만. (API 표의 규칙: 남의 글을 고치는 것은 허용하지 않는다)
export const canEdit = (user, comment) => comment.author_id === user.id;

// 삭제는 작성자, Admin, Manager, 프로젝트 소유자(해당 프로젝트 접근 검사를 통과한 경우).
export const canDelete = (user, comment, project) =>
  comment.author_id === user.id ||
  user.role === 'admin' ||
  user.role === 'manager' ||
  project.owner_id === user.id;

export async function list(task) {
  return (await repo.listByTask(task.id)).map(repo.toComment);
}

const invalidMention = (message) => new AppError(400, 'INVALID_MENTION', message);

// 멘션할 사용자를 검증하고 이름 스냅샷을 붙인다.
// - 활성 프로젝트 멤버여야 한다.
// - 본문에 그 사람의 `@이름` 이 실제로 있어야 한다(보이지 않는 멘션으로 알림만 보내는 것을 막는다).
export async function resolveMentions(project, body, mentionIds) {
  const ids = [...new Set(mentionIds ?? [])];
  if (ids.length === 0) return [];
  const names = new Map((await repo.memberNames(project.id, ids)).map((m) => [m.id, m.name]));
  return ids.map((id) => {
    const name = names.get(id);
    if (!name) throw invalidMention('프로젝트 멤버가 아닌 사용자는 멘션할 수 없습니다.');
    if (!body.includes(`@${name}`)) {
      throw invalidMention(`본문에 @${name} 이(가) 없어 멘션할 수 없습니다.`);
    }
    return { id, name };
  });
}

// 답글 대상(원 댓글)을 확인한다. 같은 작업의 삭제되지 않은 최상위 댓글이어야 한다.
// 없는 댓글·다른 작업의 댓글을 구별하지 않고 404 로 답한다.
async function loadParent(task, parentId) {
  const parent = await repo.findById(parentId);
  if (!parent || parent.task_id !== task.id || parent.deleted_at) {
    throw notFound('답글을 달 댓글을 찾을 수 없습니다.');
  }
  if (parent.parent_id) {
    throw new AppError(400, 'REPLY_TO_REPLY', '답글에는 다시 답글을 달 수 없습니다.');
  }
  return parent;
}

// 반환: { comment, parent } — parent 는 답글일 때 원 댓글 행(알림 대상 계산용), 아니면 null.
export async function create(task, project, user, body, mentionIds, parentId = null) {
  assertWritable(project);
  const parent = parentId ? await loadParent(task, parentId) : null;
  const mentions = await resolveMentions(project, body, mentionIds);
  const row = await repo.insertComment({
    taskId: task.id,
    authorId: user.id,
    body,
    mentions,
    parentId: parent?.id ?? null,
  });
  return { comment: repo.toComment(row), parent };
}

export async function update(comment, project, user, body, mentionIds) {
  assertWritable(project);
  if (comment.deleted_at) throw notFound('댓글을 찾을 수 없습니다.');
  if (!canEdit(user, comment)) throw forbidden('본인이 쓴 댓글만 수정할 수 있습니다.');
  const mentions = await resolveMentions(project, body, mentionIds);
  const updated = await repo.updateBody(comment.id, body, mentions);
  if (!updated) throw notFound('댓글을 찾을 수 없습니다.');
  return repo.toComment(updated);
}

// 반응은 멤버면 누구나 달 수 있고, 본문을 바꾸지 않으므로 updated_at 도 건드리지 않는다.
export async function react(comment, project, user, key, on) {
  assertWritable(project);
  if (comment.deleted_at) throw notFound('댓글을 찾을 수 없습니다.');
  await repo.setReaction(comment.id, user.id, key, on);
  return repo.toComment(await repo.findById(comment.id));
}

export async function remove(comment, project, user) {
  assertWritable(project);
  if (comment.deleted_at) throw notFound('댓글을 찾을 수 없습니다.');
  if (!canDelete(user, comment, project)) throw forbidden('이 댓글을 삭제할 권한이 없습니다.');
  await repo.softDelete(comment.id);
}
