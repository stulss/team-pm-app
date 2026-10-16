import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireProjectMember } from '../../middleware/requireProjectMember.js';
import { chatSendLimiter } from '../../middleware/rateLimit.js';
import { emitToProject } from '../../sockets/emitter.js';
import * as service from './service.js';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().min(1).optional(),
});
const sendBody = z.object({
  body: z
    .string()
    .trim()
    .min(1, '메시지를 입력해 주세요.')
    .max(2000, '메시지는 2000자까지 보낼 수 있습니다.'),
});
const deleteParams = z.object({ id: z.uuid(), messageId: z.uuid() });

// /projects/:id/chat
export const projectChatRouter = Router({ mergeParams: true });
projectChatRouter.use(authenticate);

projectChatRouter.get(
  '/',
  requireProjectMember(),
  validate(listQuery, 'query'),
  async (req, res) => {
    res.json(await service.list(req.project.id, req.query));
  },
);

projectChatRouter.post(
  '/',
  requireProjectMember(),
  chatSendLimiter,
  validate(sendBody),
  async (req, res) => {
    const message = await service.send(req.project, req.user, req.body.body);
    await emitToProject(req, req.project.id, 'chat:created', {
      projectId: req.project.id,
      message,
    });
    res.status(201).json(message);
  },
);

projectChatRouter.delete(
  '/:messageId',
  validate(deleteParams, 'params'),
  requireProjectMember(),
  async (req, res) => {
    await service.remove(req.project, req.user, req.params.messageId);
    await emitToProject(req, req.project.id, 'chat:deleted', {
      projectId: req.project.id,
      messageId: req.params.messageId,
    });
    res.status(204).end();
  },
);
