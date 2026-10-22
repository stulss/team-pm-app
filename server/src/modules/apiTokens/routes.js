import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { forbidden } from '../../utils/errors.js';
import { SCOPES } from './service.js';
import * as service from './service.js';

const createBody = z.object({
  name: z.string().trim().min(1, '토큰 이름을 입력해 주세요.').max(60),
  scope: z.enum(SCOPES),
  expiresInDays: z
    .union([z.literal(30), z.literal(90)])
    .nullable()
    .default(null),
});
const idParam = z.object({ id: z.uuid('올바르지 않은 ID 입니다.') });

// /users/me/api-tokens — 토큰 관리는 JWT 로그인으로만 한다(토큰으로 토큰을 만들거나 지우지 못하게).
export const apiTokensRouter = Router();
apiTokensRouter.use(authenticate, (req, res, next) =>
  req.apiToken ? next(forbidden('API 토큰으로는 토큰을 관리할 수 없습니다.')) : next(),
);

apiTokensRouter.get('/', async (req, res) => {
  res.json({ data: await service.list(req.user.id) });
});

apiTokensRouter.post('/', validate(createBody), async (req, res) => {
  res.status(201).json(await service.create(req.user, req.body));
});

apiTokensRouter.delete('/:id', validate(idParam, 'params'), async (req, res) => {
  await service.revoke(req.user.id, req.params.id);
  res.status(204).end();
});
