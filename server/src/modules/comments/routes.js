import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireTaskAccess } from '../../middleware/requireTaskAccess.js';
import { requireCommentAccess } from '../../middleware/requireCommentAccess.js';
import { emitToProject } from '../../sockets/emitter.js';
import { notifyCommentAdded, notifyMentioned } from '../notifications/service.js';
import { record } from '../activity/service.js';
import { REACTION_KEYS } from '../../utils/reactions.js';
import * as service from './service.js';

const body = z.object({
  body: z
    .string()
    .trim()
    .min(1, '댓글 내용을 입력해 주세요.')
    .max(5000, '댓글은 5000자까지 쓸 수 있습니다.'),
  // 자동완성에서 고른 멘션 대상. 본문에 @이름 이 실제로 있어야 하고, 프로젝트 멤버여야 한다.
  mentionIds: z.array(z.uuid('올바르지 않은 사용자 ID 입니다.')).max(10).optional(),
});

const reactionParams = z.object({ id: z.uuid(), key: z.enum(REACTION_KEYS) });

// /tasks/:id/comments
export const taskCommentsRouter = Router({ mergeParams: true });
taskCommentsRouter.use(authenticate);

taskCommentsRouter.get('/', requireTaskAccess(), async (req, res) => {
  res.json({ data: await service.list(req.task) });
});

taskCommentsRouter.post('/', requireTaskAccess(), validate(body), async (req, res) => {
  const comment = await service.create(
    req.task,
    req.project,
    req.user,
    req.body.body,
    req.body.mentionIds,
  );
  const mentionedIds = comment.mentions.map((m) => m.id);
  await emitToProject(req, req.project.id, 'comment:created', {
    projectId: req.project.id,
    taskId: req.task.id,
    comment,
  });
  // 멘션된 사람에게는 멘션 알림 하나만 간다(댓글 알림과 겹치지 않게 제외).
  await notifyCommentAdded({ task: req.task, actor: req.user, excludeUserIds: mentionedIds });
  await notifyMentioned({ task: req.task, actor: req.user, userIds: mentionedIds });
  // 댓글 본문은 기록하지 않는다(수정·삭제된 내용이 남지 않게).
  await record({
    projectId: req.project.id,
    taskId: req.task.id,
    actorId: req.user.id,
    action: 'comment.created',
    meta: { taskTitle: req.task.title },
  });
  res.status(201).json(comment);
});

// /comments
export const commentsRouter = Router();
commentsRouter.use(authenticate);

commentsRouter.patch('/:id', requireCommentAccess(), validate(body), async (req, res) => {
  const before = new Set(req.comment.mentions.map((m) => m.id)); // 수정 전 멘션
  const comment = await service.update(
    req.comment,
    req.project,
    req.user,
    req.body.body,
    req.body.mentionIds,
  );
  // 새로 추가된 멘션에게만 알린다(같은 사람을 다시 알리지 않는다).
  await notifyMentioned({
    task: { id: comment.taskId, title: req.comment.task_title, project_id: req.project.id },
    actor: req.user,
    userIds: comment.mentions.map((m) => m.id).filter((id) => !before.has(id)),
  });
  await emitToProject(req, req.project.id, 'comment:updated', {
    projectId: req.project.id,
    taskId: comment.taskId,
    comment,
  });
  res.json(comment);
});

commentsRouter.delete('/:id', requireCommentAccess(), async (req, res) => {
  await service.remove(req.comment, req.project, req.user);
  await emitToProject(req, req.project.id, 'comment:deleted', {
    projectId: req.project.id,
    taskId: req.comment.task_id,
    commentId: req.comment.id,
  });
  await record({
    projectId: req.project.id,
    taskId: req.comment.task_id,
    actorId: req.user.id,
    action: 'comment.deleted',
    meta: { taskTitle: req.comment.task_title ?? null },
  });
  res.status(204).end();
});

// 반응 달기(PUT)·거두기(DELETE): 갱신된 댓글을 돌려주고 다른 사용자에게는 comment:updated 로 알린다.
for (const [method, on] of [
  ['put', true],
  ['delete', false],
]) {
  commentsRouter[method](
    '/:id/reactions/:key',
    validate(reactionParams, 'params'),
    requireCommentAccess(),
    async (req, res) => {
      const comment = await service.react(req.comment, req.project, req.user, req.params.key, on);
      await emitToProject(req, req.project.id, 'comment:updated', {
        projectId: req.project.id,
        taskId: comment.taskId,
        comment,
      });
      res.json(comment);
    },
  );
}
