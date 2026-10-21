import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireTaskAccess } from '../../middleware/requireTaskAccess.js';
import { emitToProject } from '../../sockets/emitter.js';
import * as service from './service.js';

const createBody = z.object({ dependsOnId: z.uuid('올바르지 않은 작업 ID 입니다.') });
const params = z.object({ id: z.uuid(), dependsOnId: z.uuid() });

const changed = (req, task) =>
  emitToProject(req, req.project.id, 'task:updated', { projectId: req.project.id, task });

// /tasks/:id/dependencies
export const taskDependenciesRouter = Router({ mergeParams: true });
taskDependenciesRouter.use(authenticate);

taskDependenciesRouter.get('/', requireTaskAccess(), async (req, res) => {
  res.json(await service.list(req.task));
});

taskDependenciesRouter.post('/', requireTaskAccess(), validate(createBody), async (req, res) => {
  const result = await service.add(req.task, req.project, req.body.dependsOnId);
  await changed(req, result.task);
  res.status(201).json(result);
});

taskDependenciesRouter.delete(
  '/:dependsOnId',
  validate(params, 'params'),
  requireTaskAccess(),
  async (req, res) => {
    const result = await service.remove(req.task, req.project, req.params.dependsOnId);
    await changed(req, result.task);
    res.json(result);
  },
);
