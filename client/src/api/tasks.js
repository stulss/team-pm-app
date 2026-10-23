import { http } from './http.js';

const data = (res) => res.data;

export const listProjectTasks = (projectId, params) =>
  http.get(`/projects/${projectId}/tasks`, { params }).then(data);
export const createTask = (projectId, body) =>
  http.post(`/projects/${projectId}/tasks`, body).then(data);
export const updateTask = (id, body) => http.patch(`/tasks/${id}`, body).then(data);
export const deleteTask = (id) => http.delete(`/tasks/${id}`);
// 일괄 수정·삭제(최대 50개). patch 는 { status?, priority?, assigneeId?, dueDate? }.
export const bulkUpdateTasks = (projectId, taskIds, patch) =>
  http.patch(`/projects/${projectId}/tasks/bulk`, { taskIds, patch }).then(data);
export const bulkDeleteTasks = (projectId, taskIds) =>
  http.post(`/projects/${projectId}/tasks/bulk-delete`, { taskIds }).then(data);
export const listMyTasks = (params) => http.get('/tasks/mine', { params }).then(data);
export const moveTask = (id, body) => http.patch(`/tasks/${id}/move`, body).then(data);
// 작업 키(TPM-12)로 조회한다.
export const getTaskByKey = (key) => http.get(`/tasks/key/${encodeURIComponent(key)}`).then(data);
export const getTask = (id) => http.get(`/tasks/${id}`).then(data);
