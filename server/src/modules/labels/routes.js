import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireProjectMember } from '../../middleware/requireProjectMember.js';
import { requireTaskAccess } from '../../middleware/requireTaskAccess.js';
import { emitToProject } from '../../sockets/emitter.js';
import { COLORS } from './repository.js';
import * as service from './service.js';

const name = z
  .string()
  .trim()
  .min(1, '라벨 이름을 입력해 주세요.')
  .max(30, '라벨 이름은 30자까지 쓸 수 있습니다.');
const color = z.enum(COLORS);
const createBody = z.object({ name, color });
const patchBody = z
  .object({ name: name.optional(), color: color.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 항목이 없습니다.' });
const labelParams = z.object({ id: z.uuid(), labelId: z.uuid() });
const setBody = z.object({ labelIds: z.array(z.uuid('올바르지 않은 라벨 ID 입니다.')).max(50) });

const changed = (req) =>
  emitToProject(req, req.project.id, 'label:changed', { projectId: req.project.id });

// /projects/:id/labels
export const projectLabelsRouter = Router({ mergeParams: true });
projectLabelsRouter.use(authenticate);

projectLabelsRouter.get('/', requireProjectMember(), async (req, res) => {
  res.json({ data: await service.list(req.project) });
});

projectLabelsRouter.post('/', requireProjectMember(), validate(createBody), async (req, res) => {
  const label = await service.create(req.project, req.user, req.body);
  await changed(req);
  res.status(201).json(label);
});

projectLabelsRouter.patch(
  '/:labelId',
  validate(labelParams, 'params'),
  requireProjectMember(),
  validate(patchBody),
  async (req, res) => {
    const label = await service.update(req.project, req.user, req.params.labelId, req.body);
    await changed(req);
    res.json(label);
  },
);

projectLabelsRouter.delete(
  '/:labelId',
  validate(labelParams, 'params'),
  requireProjectMember(),
  async (req, res) => {
    await service.remove(req.project, req.user, req.params.labelId);
    await changed(req);
    res.status(204).end();
  },
);

// /tasks/:id/labels
export const taskLabelsRouter = Router({ mergeParams: true });
taskLabelsRouter.use(authenticate);

taskLabelsRouter.put('/', requireTaskAccess(), validate(setBody), async (req, res) => {
  const task = await service.setForTask(req.task, req.project, req.body.labelIds);
  await emitToProject(req, req.project.id, 'task:updated', { projectId: req.project.id, task });
  res.json(task);
});
