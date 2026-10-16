import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { searchLimiter } from '../../middleware/rateLimit.js';
import * as service from './service.js';

const searchQuery = z.object({
  q: z
    .string()
    .trim()
    .min(2, '검색어는 2자 이상 입력해 주세요.')
    .max(50, '검색어는 50자까지입니다.'),
  type: z.enum(['all', 'project', 'task', 'comment', 'chat']).default('all'),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

// /search — 로그인한 사용자. 결과는 내가 접근할 수 있는 프로젝트로 한정된다.
export const searchRouter = Router();
searchRouter.use(authenticate);

searchRouter.get('/', searchLimiter, validate(searchQuery, 'query'), async (req, res) => {
  res.json(await service.search(req.user, req.query));
});
