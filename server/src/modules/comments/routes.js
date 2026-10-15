import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireTaskAccess } from '../../middleware/requireTaskAccess.js';
import { requireCommentAccess } from '../../middleware/requireCommentAccess.js';
import { emitToProject } from '../../sockets/emitter.js';
import * as service from './service.js';

const body = z.object({
  body: z
    .string()
    .trim()
    .min(1, '댓글 내용을 입력해 주세요.')
    .max(5000, '댓글은 5000자까지 쓸 수 있습니다.'),
});

// /tasks/:id/comments
export const taskCommentsRouter = Router({ mergeParams: true });
taskCommentsRouter.use(authenticate);

taskCommentsRouter.get('/', requireTaskAccess(), async (req, res) => {
  res.json({ data: await service.list(req.task) });
});

taskCommentsRouter.post('/', requireTaskAccess(), validate(body), async (req, res) => {
  const comment = await service.create(req.task, req.project, req.user, req.body.body);
  await emitToProject(req, req.project.id, 'comment:created', {
    projectId: req.project.id,
    taskId: req.task.id,
    comment,
  });
  res.status(201).json(comment);
});

// /comments
export const commentsRouter = Router();
commentsRouter.use(authenticate);

commentsRouter.patch('/:id', requireCommentAccess(), validate(body), async (req, res) => {
  const comment = await service.update(req.comment, req.project, req.user, req.body.body);
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
  res.status(204).end();
});
