import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireProjectMember } from '../../middleware/requireProjectMember.js';
import * as service from './service.js';

// /projects/:id/dashboard — 프로젝트 멤버(또는 Admin)
export const projectDashboardRouter = Router({ mergeParams: true });
projectDashboardRouter.use(authenticate);
projectDashboardRouter.get('/', requireProjectMember(), async (req, res) => {
  res.json(await service.projectDashboard(req.project));
});

// /dashboard — 내 전체 요약 (소속 프로젝트 합산, Admin 은 전체)
export const dashboardRouter = Router();
dashboardRouter.use(authenticate);
dashboardRouter.get('/', async (req, res) => {
  res.json(await service.overallDashboard(req.user));
});
