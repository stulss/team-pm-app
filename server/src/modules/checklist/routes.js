import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireTaskAccess } from '../../middleware/requireTaskAccess.js';
import { emitToProject } from '../../sockets/emitter.js';
import * as service from './service.js';

const content = z
  .string()
  .trim()
  .min(1, '내용을 입력해 주세요.')
  .max(200, '내용은 200자까지 쓸 수 있습니다.');
const createBody = z.object({ content });
const patchBody = z
  .object({ content: content.optional(), isDone: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 항목이 없습니다.' });
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });

const changed = (req, task) =>
  emitToProject(req, req.project.id, 'task:updated', { projectId: req.project.id, task });

// /tasks/:id/checklist
export const taskChecklistRouter = Router({ mergeParams: true });
taskChecklistRouter.use(authenticate);

taskChecklistRouter.get('/', requireTaskAccess(), async (req, res) => {
  res.json({ data: await service.list(req.task) });
});

taskChecklistRouter.post('/', requireTaskAccess(), validate(createBody), async (req, res) => {
  const { item, task } = await service.add(req.task, req.project, req.body);
  await changed(req, task);
  res.status(201).json({ item, task });
});

taskChecklistRouter.patch(
  '/:itemId',
  validate(itemParams, 'params'),
  requireTaskAccess(),
  validate(patchBody),
  async (req, res) => {
    const { item, task } = await service.update(req.task, req.project, req.params.itemId, req.body);
    await changed(req, task);
    res.json({ item, task });
  },
);

taskChecklistRouter.delete(
  '/:itemId',
  validate(itemParams, 'params'),
  requireTaskAccess(),
  async (req, res) => {
    const { task } = await service.remove(req.task, req.project, req.params.itemId);
    await changed(req, task);
    res.json({ task });
  },
);
