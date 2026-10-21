import { http } from './http.js';

const data = (res) => res.data;

export const listLabels = (projectId) => http.get(`/projects/${projectId}/labels`).then(data);
export const createLabel = (projectId, body) =>
  http.post(`/projects/${projectId}/labels`, body).then(data);
export const updateLabel = (projectId, labelId, body) =>
  http.patch(`/projects/${projectId}/labels/${labelId}`, body).then(data);
export const deleteLabel = (projectId, labelId) =>
  http.delete(`/projects/${projectId}/labels/${labelId}`);
export const setTaskLabels = (taskId, labelIds) =>
  http.put(`/tasks/${taskId}/labels`, { labelIds }).then(data);
