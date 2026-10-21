import express, { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireProjectManager } from '../../middleware/requireProjectMember.js';
import { requireTaskAccess } from '../../middleware/requireTaskAccess.js';
import { logger } from '../../utils/logger.js';
import { normalizeRepo, verifySignature, webhookSecret } from './parse.js';
import * as repo from './repository.js';
import * as service from './service.js';

const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

const connectBody = z.object({
  repo: z
    .string()
    .trim()
    .max(200)
    .transform((v) => normalizeRepo(v))
    .refine((v) => v !== null, 'GitHub 저장소는 owner/repo 형식이거나 저장소 주소여야 합니다.'),
  moveOnOpen: z.boolean().optional(),
  doneOnMerge: z.boolean().optional(),
});

// /projects/:id/github — 소유자·Admin 만(웹훅 비밀이 보이므로)
export const projectGithubRouter = Router({ mergeParams: true });
projectGithubRouter.use(authenticate);

projectGithubRouter.get('/', requireProjectManager(), async (req, res) => {
  res.json(await service.getForManager(req.project, baseUrl(req)));
});

projectGithubRouter.put('/', requireProjectManager(), validate(connectBody), async (req, res) => {
  res.json(await service.connect(req.project, req.user, req.body, baseUrl(req)));
});

projectGithubRouter.post('/rotate-secret', requireProjectManager(), async (req, res) => {
  res.json(await service.rotateSecret(req.project, baseUrl(req)));
});

projectGithubRouter.delete('/', requireProjectManager(), async (req, res) => {
  await service.disconnect(req.project, req.user);
  res.status(204).end();
});

// /tasks/:id/github-links
export const taskGithubRouter = Router({ mergeParams: true });
taskGithubRouter.use(authenticate);
taskGithubRouter.get('/', requireTaskAccess(), async (req, res) => {
  res.json({ data: await service.listLinks(req.task) });
});

// /api/webhooks — 로그인 없이 GitHub 가 호출한다. 서명(원문 바이트의 HMAC)으로 인증하므로 이 경로만
// 전용 raw 파서(2MB)를 쓴다. 전역 JSON 파서(100KB)보다 먼저 마운트해야 한다.
export const webhooksRouter = Router();
webhooksRouter.use(express.raw({ type: () => true, limit: '2mb' }));

const invalid = (res) =>
  res
    .status(401)
    .json({ error: { code: 'INVALID_SIGNATURE', message: '서명이 올바르지 않습니다.' } });

webhooksRouter.post('/github/:connectionId', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const idOk = z.uuid().safeParse(req.params.connectionId).success;
    const connection = idOk ? await repo.getById(req.params.connectionId) : null;
    // 없는 연결과 서명 불일치를 같은 응답으로 돌려 연결의 존재 여부를 알리지 않는다.
    if (!connection) return invalid(res);
    const secret = webhookSecret(connection, env.JWT_REFRESH_SECRET);
    if (!verifySignature(secret, raw, req.get('x-hub-signature-256'))) return invalid(res);

    const contentType = req.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      return res.status(415).json({
        error: {
          code: 'UNSUPPORTED_CONTENT_TYPE',
          message: '웹훅 Content type 을 application/json 으로 설정해 주세요.',
        },
      });
    }
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return res
        .status(400)
        .json({ error: { code: 'BAD_PAYLOAD', message: '본문이 JSON 이 아닙니다.' } });
    }

    const event = req.get('x-github-event') ?? '';
    const delivery = req.get('x-github-delivery');
    if (!delivery) {
      return res
        .status(400)
        .json({
          error: { code: 'MISSING_DELIVERY', message: 'X-GitHub-Delivery 헤더가 없습니다.' },
        });
    }
    // 같은 전달을 다시 받으면(재전송) 두 번 처리하지 않는다.
    if (!(await repo.claimDelivery(delivery.slice(0, 80), connection.id))) {
      return res.json({ ok: true, duplicate: true });
    }

    const { status = 200, ...body } = await service.handleWebhook(connection, event, payload);
    logger.info({ event, connectionId: connection.id, ...body }, 'github webhook handled');
    res.status(status).json({ ok: true, ...body });
  } catch (err) {
    next(err);
  }
});
