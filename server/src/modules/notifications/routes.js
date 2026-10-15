import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as service from './service.js';

const listQuery = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const idParam = z.object({ id: z.uuid('올바르지 않은 ID 입니다.') });

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  res.json(await service.list(req.user, req.query));
});

notificationsRouter.get('/unread-count', async (req, res) => {
  res.json({ count: await service.unreadCount(req.user) });
});

// '/read-all' 은 '/:id/read' 와 겹치지 않지만 가독성을 위해 고정 경로를 먼저 선언한다.
notificationsRouter.post('/read-all', async (req, res) => {
  res.json({ updated: await service.markAllRead(req.user) });
});

notificationsRouter.patch('/:id/read', validate(idParam, 'params'), async (req, res) => {
  await service.markRead(req.user, req.params.id);
  res.status(204).end();
});
