import { http } from './http.js';

// before: 이전 페이지의 마지막 seq(커서). taskId 를 주면 그 작업의 변경 이력만.
export const listActivities = (projectId, { before, taskId, limit = 30 } = {}) =>
  http
    .get(`/projects/${projectId}/activities`, { params: { before, taskId, limit } })
    .then((res) => res.data);
