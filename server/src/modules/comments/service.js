import { forbidden, notFound } from '../../utils/errors.js';
import { assertWritable } from '../tasks/service.js';
import * as repo from './repository.js';

// 수정은 작성자만. (API 표의 규칙: 남의 글을 고치는 것은 허용하지 않는다)
export const canEdit = (user, comment) => comment.author_id === user.id;

// 삭제는 작성자, Admin, Manager(해당 프로젝트 멤버로서 접근 검사를 통과한 경우).
export const canDelete = (user, comment) =>
  comment.author_id === user.id || user.role === 'admin' || user.role === 'manager';

export async function list(task) {
  return (await repo.listByTask(task.id)).map(repo.toComment);
}

export async function create(task, project, user, body) {
  assertWritable(project);
  return repo.toComment(await repo.insertComment({ taskId: task.id, authorId: user.id, body }));
}

export async function update(comment, project, user, body) {
  assertWritable(project);
  if (comment.deleted_at) throw notFound('댓글을 찾을 수 없습니다.');
  if (!canEdit(user, comment)) throw forbidden('본인이 쓴 댓글만 수정할 수 있습니다.');
  const updated = await repo.updateBody(comment.id, body);
  if (!updated) throw notFound('댓글을 찾을 수 없습니다.');
  return repo.toComment(updated);
}

export async function remove(comment, project, user) {
  assertWritable(project);
  if (comment.deleted_at) throw notFound('댓글을 찾을 수 없습니다.');
  if (!canDelete(user, comment)) throw forbidden('이 댓글을 삭제할 권한이 없습니다.');
  await repo.softDelete(comment.id);
}
