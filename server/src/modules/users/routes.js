import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { setRefreshCookie } from '../auth/routes.js';
import * as service from './service.js';

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const idParam = z.object({ id: z.uuid('올바르지 않은 ID 입니다.') });
const roleBody = z.object({ role: z.enum(['admin', 'manager', 'member']) });
const statusBody = z.object({ isActive: z.boolean() });
const meBody = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.').max(128).optional(),
  })
  .refine((v) => v.name || v.newPassword, { message: '변경할 항목이 없습니다.' });

export const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  res.json(await service.list(req.query));
});

// '/me' 는 '/:id' 보다 먼저 선언해야 한다.
usersRouter.patch('/me', validate(meBody), async (req, res) => {
  const { user, accessToken, refreshToken } = await service.updateMe(req.user.id, req.body);
  if (!accessToken) return res.json({ user });
  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken });
});

usersRouter.patch(
  '/:id/role',
  requireRole('admin'),
  validate(idParam, 'params'),
  validate(roleBody),
  async (req, res) => {
    res.json({ user: await service.changeRole(req.params.id, req.body.role) });
  },
);

usersRouter.patch(
  '/:id/status',
  requireRole('admin'),
  validate(idParam, 'params'),
  validate(statusBody),
  async (req, res) => {
    res.json({ user: await service.changeStatus(req.params.id, req.body.isActive) });
  },
);
