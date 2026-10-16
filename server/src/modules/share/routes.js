import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireProjectManager } from '../../middleware/requireProjectMember.js';
import { sharedLimiter } from '../../middleware/rateLimit.js';
import * as service from './service.js';

const createBody = z.object({
  expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
});
const linkParams = z.object({ id: z.uuid(), linkId: z.uuid() });
const viewParams = z.object({ token: z.string().min(20).max(100) });
const viewQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  before: z.coerce.number().int().min(1).optional(),
});

// /projects/:id/share-links — Admin 과 프로젝트 소유자만
export const projectShareRouter = Router({ mergeParams: true });
projectShareRouter.use(authenticate);

projectShareRouter.post('/', requireProjectManager(), validate(createBody), async (req, res) => {
  res.status(201).json(await service.create(req.project, req.user, req.body.expiresInDays));
});

projectShareRouter.get('/', requireProjectManager(), async (req, res) => {
  res.json({ data: await service.list(req.project) });
});

projectShareRouter.delete(
  '/:linkId',
  validate(linkParams, 'params'),
  requireProjectManager(),
  async (req, res) => {
    await service.revoke(req.project, req.user, req.params.linkId);
    res.status(204).end();
  },
);

// /shared/:token — 공개(로그인 불필요). 검색 엔진에 잡히지 않게 하고 캐시하지 않는다.
export const publicShareRouter = Router();
publicShareRouter.use(sharedLimiter);
publicShareRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

publicShareRouter.get(
  '/:token',
  validate(viewParams, 'params'),
  validate(viewQuery, 'query'),
  async (req, res) => {
    res.json(await service.view(req.params.token, req.query));
  },
);
