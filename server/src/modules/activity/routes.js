import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireProjectMember } from '../../middleware/requireProjectMember.js';
import * as service from './service.js';

const ACTIONS = [
  'project.created',
  'project.updated',
  'member.added',
  'member.removed',
  'task.created',
  'task.updated',
  'task.moved',
  'task.deleted',
  'comment.created',
  'comment.deleted',
];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  before: z.coerce.number().int().min(1).optional(),
  taskId: z.uuid().optional(),
  action: z.enum(ACTIONS).optional(),
});

// /projects/:id/activities
export const projectActivityRouter = Router({ mergeParams: true });
projectActivityRouter.use(authenticate);

projectActivityRouter.get(
  '/',
  requireProjectMember(),
  validate(listQuery, 'query'),
  async (req, res) => {
    res.json(await service.list(req.project.id, req.query));
  },
);
