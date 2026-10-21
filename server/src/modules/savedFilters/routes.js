import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireProjectMember } from '../../middleware/requireProjectMember.js';
import { STATUSES } from '../tasks/repository.js';
import * as service from './service.js';

// 저장할 수 있는 키와 값 모양을 정해 둔다(임의 JSON 저장 방지). 알 수 없는 키는 거부한다.
const filters = z.strictObject({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assignee: z.union([z.literal('me'), z.literal('unassigned'), z.uuid()]).optional(),
  label: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
const createBody = z.object({
  name: z
    .string()
    .trim()
    .min(1, '이름을 입력해 주세요.')
    .max(40, '이름은 40자까지 쓸 수 있습니다.'),
  filters,
});
const params = z.object({ id: z.uuid(), filterId: z.uuid() });

// /projects/:id/saved-filters
export const projectSavedFiltersRouter = Router({ mergeParams: true });
projectSavedFiltersRouter.use(authenticate);

projectSavedFiltersRouter.get('/', requireProjectMember(), async (req, res) => {
  res.json({ data: await service.list(req.project, req.user) });
});

projectSavedFiltersRouter.post(
  '/',
  requireProjectMember(),
  validate(createBody),
  async (req, res) => {
    res.status(201).json(await service.create(req.project, req.user, req.body));
  },
);

projectSavedFiltersRouter.delete(
  '/:filterId',
  validate(params, 'params'),
  requireProjectMember(),
  async (req, res) => {
    await service.remove(req.project, req.user, req.params.filterId);
    res.status(204).end();
  },
);
