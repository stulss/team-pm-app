import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  requireProjectManager,
  requireProjectMember,
} from '../../middleware/requireProjectMember.js';
import { emitToProject, emitToUser, removeUserFromProjectRoom } from '../../sockets/emitter.js';
import { record } from '../activity/service.js';
import * as usersRepo from '../users/repository.js';
import { KEY_PATTERN } from './key.js';
import * as service from './service.js';

const name = z.string().trim().min(1, '프로젝트 이름을 입력해 주세요.').max(100);
// 작업 키의 앞부분(TPM-12 의 TPM). 소문자로 보내도 대문자로 바꿔 검사한다.
const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(KEY_PATTERN, '프로젝트 키는 영문으로 시작하는 2~10자의 영문·숫자입니다.');
const description = z.string().trim().max(2000);

const listQuery = z.object({
  status: z.enum(['active', 'archived']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const createBody = z.object({
  name,
  key: projectKey.optional(),
  description: description.optional(),
  memberIds: z.array(z.uuid()).max(50).default([]),
});
const patchBody = z
  .object({
    name: name.optional(),
    key: projectKey.optional(),
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
  const project = await service.create(req.user, req.body);
  await record({
    projectId: project.id,
    actorId: req.user.id,
    action: 'project.created',
    meta: { name: project.name },
  });
  res.status(201).json(project);
});

projectsRouter.get('/:id', requireProjectMember(), async (req, res) => {
  res.json(await service.detail(req.project, req.user.id));
});

// 내 프로젝트 설정(알림 음소거·고정). 본인에게만 적용되는 개인 설정이라 보관된 프로젝트에서도 바꿀 수 있다.
const mySettingsBody = z
  .strictObject({ muted: z.boolean().optional(), pinned: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 항목이 없습니다.' });
projectsRouter.patch(
  '/:id/my-settings',
  requireProjectMember(),
  validate(mySettingsBody),
  async (req, res) => {
    res.json(await service.updateMySettings(req.project, req.user, req.body));
  },
);

projectsRouter.patch('/:id', requireProjectManager(), validate(patchBody), async (req, res) => {
  const prev = { name: req.project.name, status: req.project.status, key: req.project.key }; // 수정 전 값
  const project = await service.update(req.project, req.body);
  await emitToProject(req, project.id, 'project:updated', { projectId: project.id, project });
  const changes = {};
  if (project.name !== prev.name) changes.name = { from: prev.name, to: project.name };
  if (project.status !== prev.status) changes.status = { from: prev.status, to: project.status };
  if (project.key !== prev.key) changes.key = { from: prev.key, to: project.key };
  if (Object.keys(changes).length > 0) {
    await record({
      projectId: project.id,
      actorId: req.user.id,
      action: 'project.updated',
      meta: { changes },
    });
  }
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
    await record({
      projectId: req.project.id,
      actorId: req.user.id,
      action: 'member.added',
      meta: { user: { id: user.id, name: user.name } },
    });
    res.status(201).json({ user });
  },
);

projectsRouter.delete(
  '/:id/members/:userId',
  validate(memberParams, 'params'),
  requireProjectManager(),
  async (req, res) => {
    const target = await usersRepo.findById(req.params.userId);
    await service.removeMember(req.project, req.params.userId);
    const payload = { projectId: req.project.id, user: { id: req.params.userId } };
    // 제거되는 사용자도 이벤트를 받은 뒤(목록 갱신) 방에서 내보낸다.
    await emitToProject(req, req.project.id, 'member:removed', payload);
    await emitToUser(req.params.userId, 'member:removed', payload);
    await removeUserFromProjectRoom(req.params.userId, req.project.id);
    await record({
      projectId: req.project.id,
      actorId: req.user.id,
      action: 'member.removed',
      meta: { user: { id: req.params.userId, name: target?.name ?? null } },
    });
    res.status(204).end();
  },
);
