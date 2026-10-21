import { forbidden, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { assertWritable } from '../tasks/service.js';
import { resolveMentions } from '../comments/service.js';
import * as repo from './repository.js';

// 삭제는 작성자, 프로젝트 소유자, Admin.
export const canDelete = (user, message, project) =>
  message.author_id === user.id || user.role === 'admin' || project.owner_id === user.id;

export async function list(projectId, { limit, before }) {
  const rows = await repo.list(projectId, { limit, before });
  const page = rows.slice(0, limit);
  return {
    data: page.map(repo.toMessage),
    nextCursor: rows.length > limit ? Number(page[page.length - 1].seq) : null,
  };
}

export async function send(project, user, body, mentionIds) {
  assertWritable(project);
  // 댓글 멘션(M11)과 같은 검증: 활성 프로젝트 멤버여야 하고 본문에 @이름 이 있어야 한다.
  const mentions = await resolveMentions(project, body, mentionIds);
  const message = repo.toMessage(
    await repo.insert({ projectId: project.id, authorId: user.id, body, mentions }),
  );
  // 상한 정리는 부가 작업이다. 실패해도 메시지 전송은 성공시킨다.
  try {
    await repo.trim(project.id, repo.MAX_PER_PROJECT);
  } catch (err) {
    logger.warn({ err: err.message }, 'chat trim failed');
  }
  return message;
}

export async function react(project, user, messageId, key, on) {
  assertWritable(project);
  const message = await repo.findById(project.id, messageId);
  if (!message) throw notFound('메시지를 찾을 수 없습니다.');
  await repo.setReaction(message.id, user.id, key, on);
  return repo.toMessage(await repo.findById(project.id, messageId));
}

export async function remove(project, user, messageId) {
  assertWritable(project);
  const message = await repo.findById(project.id, messageId);
  if (!message) throw notFound('메시지를 찾을 수 없습니다.');
  if (!canDelete(user, message, project)) throw forbidden('이 메시지를 삭제할 권한이 없습니다.');
  await repo.remove(project.id, messageId);
}
