import { z } from 'zod';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import * as tasks from '../modules/tasks/repository.js';
import * as projects from '../modules/projects/repository.js';

const uuid = z.uuid();

// 작업이 속한 프로젝트의 멤버(또는 Admin)만 통과. req.task, req.project 를 싣는다.
export const requireTaskAccess =
  (paramName = 'id') =>
  async (req, res, next) => {
    try {
      const parsed = uuid.safeParse(req.params[paramName]);
      if (!parsed.success) throw badRequest('올바르지 않은 작업 ID 입니다.');
      const task = await tasks.findById(parsed.data);
      if (!task) throw notFound('작업을 찾을 수 없습니다.');

      const project = await projects.findById(task.project_id);
      if (req.user.role !== 'admin' && !(await projects.isMember(project.id, req.user.id))) {
        throw forbidden('프로젝트 멤버가 아닙니다.');
      }
      req.task = task;
      req.project = project;
      next();
    } catch (err) {
      next(err);
    }
  };
