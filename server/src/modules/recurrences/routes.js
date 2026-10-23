import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  requireProjectManager,
  requireProjectMember,
} from '../../middleware/requireProjectMember.js';
import { todayIn } from '../notifications/service.js';
import * as service from './service.js';

const fields = {
  title: z.string().trim().min(1, '제목을 입력해 주세요.').max(200),
  description: z.string().max(10_000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  assigneeId: z.uuid('올바르지 않은 담당자 ID 입니다.'),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  weekday: z.number().int().min(0).max(6),
  monthDay: z.number().int().min(1).max(31),
  dueAfterDays: z.number().int().min(0).max(60),
  active: z.boolean(),
};

const createBody = z.object({
  title: fields.title,
  description: fields.description.nullish(),
  priority: fields.priority.default('medium'),
  assigneeId: fields.assigneeId.nullish(),
  frequency: fields.frequency,
  weekday: fields.weekday.nullish(),
  monthDay: fields.monthDay.nullish(),
  dueAfterDays: fields.dueAfterDays.nullish(),
  active: fields.active.optional(),
});
const patchBody = z
  .object({
    title: fields.title.optional(),
    description: fields.description.nullable().optional(),
    priority: fields.priority.optional(),
    assigneeId: fields.assigneeId.nullable().optional(),
    frequency: fields.frequency.optional(),
    weekday: fields.weekday.nullable().optional(),
    monthDay: fields.monthDay.nullable().optional(),
    dueAfterDays: fields.dueAfterDays.nullable().optional(),
    active: fields.active.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 항목이 없습니다.' });
const params = z.object({ id: z.uuid(), rid: z.uuid() });

// /projects/:id/recurrences — 조회는 멤버, 변경은 프로젝트 관리 권한. API 토큰으로는 호출할 수 없다.
export const projectRecurrencesRouter = Router({ mergeParams: true });
projectRecurrencesRouter.use(authenticate);

projectRecurrencesRouter.get('/', requireProjectMember(), async (req, res) => {
  res.json({ data: await service.list(req.project) });
});

projectRecurrencesRouter.post(
  '/',
  requireProjectManager(),
  validate(createBody),
  async (req, res) => {
    res.status(201).json(await service.create(req.project, req.user, req.body, todayIn()));
  },
);

projectRecurrencesRouter.patch(
  '/:rid',
  validate(params, 'params'),
  requireProjectManager(),
  validate(patchBody),
  async (req, res) => {
    res.json(await service.update(req.project, req.params.rid, req.body, todayIn()));
  },
);

projectRecurrencesRouter.delete(
  '/:rid',
  validate(params, 'params'),
  requireProjectManager(),
  async (req, res) => {
    await service.remove(req.project, req.params.rid);
    res.status(204).end();
  },
);
