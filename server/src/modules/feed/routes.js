import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as service from './service.js';

// /feed — 로그인한 사용자 본인의 모아보기
export const feedRouter = Router();
feedRouter.use(authenticate);

feedRouter.get('/', async (req, res) => {
  res.json(await service.feed(req.user));
});
