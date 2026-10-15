import { z } from 'zod';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import * as comments from '../modules/comments/repository.js';
import * as projects from '../modules/projects/repository.js';

const uuid = z.uuid();

// 댓글이 달린 작업의 프로젝트 멤버(또는 Admin)만 통과. req.comment, req.project 를 싣는다.
export const requireCommentAccess =
  (paramName = 'id') =>
  async (req, res, next) => {
    try {
      const parsed = uuid.safeParse(req.params[paramName]);
      if (!parsed.success) throw badRequest('올바르지 않은 댓글 ID 입니다.');
      const comment = await comments.findById(parsed.data);
      if (!comment) throw notFound('댓글을 찾을 수 없습니다.');

      const project = await projects.findById(comment.project_id);
      if (req.user.role !== 'admin' && !(await projects.isMember(project.id, req.user.id))) {
        throw forbidden('프로젝트 멤버가 아닙니다.');
      }
      req.comment = comment;
      req.project = project;
      next();
    } catch (err) {
      next(err);
    }
  };
