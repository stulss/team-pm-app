import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  requireProjectManager,
  requireProjectMember,
} from '../../middleware/requireProjectMember.js';
import { emitToProject, emitToUser, removeUserFromProjectRoom } from '../../sockets/emitter.js';
import * as service from './service.js';

const name = z.string().trim().min(1, '프로젝트 이름을 입력해 주세요.').max(100);
const description = z.string().trim().max(2000);

const listQuery = z.object({
  status: z.enum(['active', 'archived']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const createBody = z.object({
  name,
  description: description.optional(),
  memberIds: z.array(z.uuid()).max(50).default([]),
});
const patchBody = z
  .object({
    name: name.optional(),
    description: description.optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 항목이 없습니다.' });
const addMemberBody = z
  .object({
    userId: z.uuid('올바르지 않은 사용자 ID 입니다.').optional(),
    email: z.string().trim().max(254).pipe(z.email('올바른 이메일 형식이 아닙니다.')).optional(),
  })
  .refine((v) => Boolean(v.userId) !== Boolean(v.email), {
    message: 'userId 또는 email 중 하나만 보내 주세요.',
  });
const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });

export const projectsRouter = Router();
projectsRouter.use(authenticate);

projectsRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  res.json(await service.list(req.user, req.query));
});

// 로그인한 누구나 프로젝트를 만들 수 있고, 만든 사람이 소유자(관리자)가 된다.
projectsRouter.post('/', validate(createBody), async (req, res) => {
  res.status(201).json(await service.create(req.user, req.body));
});

projectsRouter.get('/:id', requireProjectMember(), async (req, res) => {
  res.json(await service.detail(req.project));
});

projectsRouter.patch('/:id', requireProjectManager(), validate(patchBody), async (req, res) => {
  const project = await service.update(req.project, req.body);
  await emitToProject(req, project.id, 'project:updated', { projectId: project.id, project });
  res.json(project);
});

// 삭제(하드 삭제, CASCADE)는 Admin 과 프로젝트 소유자. 되돌릴 수 있는 정리는 status=archived 로 한다.
projectsRouter.delete('/:id', requireProjectManager(), async (req, res) => {
  await service.remove(req.project);
  await emitToProject(req, req.project.id, 'project:deleted', { projectId: req.project.id });
  res.status(204).end();
});

projectsRouter.get('/:id/members', requireProjectMember(), async (req, res) => {
  res.json({ data: await service.listMembers(req.project) });
});

projectsRouter.post(
  '/:id/members',
  requireProjectManager(),
  validate(addMemberBody),
  async (req, res) => {
    const user = await service.addMember(req.project, req.body);
    const payload = { projectId: req.project.id, user };
    await emitToProject(req, req.project.id, 'member:added', payload);
    await emitToUser(user.id, 'member:added', payload); // 새 멤버의 프로젝트 목록 갱신용
    res.status(201).json({ user });
  },
);

projectsRouter.delete(
  '/:id/members/:userId',
  validate(memberParams, 'params'),
  requireProjectManager(),
  async (req, res) => {
    await service.removeMember(req.project, req.params.userId);
    const payload = { projectId: req.project.id, user: { id: req.params.userId } };
    // 제거되는 사용자도 이벤트를 받은 뒤(목록 갱신) 방에서 내보낸다.
    await emitToProject(req, req.project.id, 'member:removed', payload);
    await emitToUser(req.params.userId, 'member:removed', payload);
    await removeUserFromProjectRoom(req.params.userId, req.project.id);
    res.status(204).end();
  },
);
