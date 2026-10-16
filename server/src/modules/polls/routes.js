import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireProjectMember } from '../../middleware/requireProjectMember.js';
import { emitToProject } from '../../sockets/emitter.js';
import * as service from './service.js';

const createBody = z.object({
  question: z
    .string()
    .trim()
    .min(1, '질문을 입력해 주세요.')
    .max(200, '질문은 200자까지 쓸 수 있습니다.'),
  options: z
    .array(
      z
        .string()
        .trim()
        .min(1, '선택지를 입력해 주세요.')
        .max(100, '선택지는 100자까지 쓸 수 있습니다.'),
    )
    .min(2, '선택지는 2개 이상 필요합니다.')
    .max(10, '선택지는 10개까지 만들 수 있습니다.'),
  multiple: z.boolean().optional(),
});
const voteBody = z.object({
  optionIds: z.array(z.uuid('올바르지 않은 선택지 ID 입니다.')).max(10),
});
const pollParams = z.object({ id: z.uuid(), pollId: z.uuid() });

const changed = (req, pollId) =>
  emitToProject(req, req.project.id, 'poll:changed', { projectId: req.project.id, pollId });

// /projects/:id/polls
export const projectPollsRouter = Router({ mergeParams: true });
projectPollsRouter.use(authenticate);

projectPollsRouter.get('/', requireProjectMember(), async (req, res) => {
  res.json({ data: await service.list(req.project, req.user) });
});

projectPollsRouter.post('/', requireProjectMember(), validate(createBody), async (req, res) => {
  const poll = await service.create(req.project, req.user, req.body);
  await changed(req, poll.id);
  res.status(201).json(poll);
});

projectPollsRouter.put(
  '/:pollId/vote',
  validate(pollParams, 'params'),
  requireProjectMember(),
  validate(voteBody),
  async (req, res) => {
    const poll = await service.vote(req.project, req.user, req.params.pollId, req.body.optionIds);
    await changed(req, poll.id);
    res.json(poll);
  },
);

projectPollsRouter.post(
  '/:pollId/close',
  validate(pollParams, 'params'),
  requireProjectMember(),
  async (req, res) => {
    const poll = await service.close(req.project, req.user, req.params.pollId);
    await changed(req, poll.id);
    res.json(poll);
  },
);

projectPollsRouter.delete(
  '/:pollId',
  validate(pollParams, 'params'),
  requireProjectMember(),
  async (req, res) => {
    await service.remove(req.project, req.user, req.params.pollId);
    await changed(req, req.params.pollId);
    res.status(204).end();
  },
);
