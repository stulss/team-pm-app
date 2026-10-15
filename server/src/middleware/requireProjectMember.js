import { z } from 'zod';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import * as projects from '../modules/projects/repository.js';
import { canManage } from '../modules/projects/service.js';

const uuid = z.uuid();

async function loadProject(req, paramName) {
  const parsed = uuid.safeParse(req.params[paramName]);
  if (!parsed.success) throw badRequest('올바르지 않은 프로젝트 ID 입니다.');
  const project = await projects.findById(parsed.data);
  if (!project) throw notFound('프로젝트를 찾을 수 없습니다.');
  return project;
}

// 프로젝트 멤버(또는 Admin)만 통과. req.project 에 프로젝트 행을 싣는다.
export const requireProjectMember =
  (paramName = 'id') =>
  async (req, res, next) => {
    try {
      const project = await loadProject(req, paramName);
      if (req.user.role !== 'admin' && !(await projects.isMember(project.id, req.user.id))) {
        throw forbidden('프로젝트 멤버가 아닙니다.');
      }
      req.project = project;
      next();
    } catch (err) {
      next(err);
    }
  };

// 프로젝트 관리 권한(Admin 또는 소유 Manager)만 통과.
export const requireProjectManager =
  (paramName = 'id') =>
  async (req, res, next) => {
    try {
      const project = await loadProject(req, paramName);
      if (!canManage(req.user, project)) throw forbidden('프로젝트를 관리할 권한이 없습니다.');
      req.project = project;
      next();
    } catch (err) {
      next(err);
    }
  };
