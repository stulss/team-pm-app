import { http } from './http.js';

const data = (res) => res.data;

export const listChecklist = (taskId) => http.get(`/tasks/${taskId}/checklist`).then(data);
export const addChecklistItem = (taskId, content) =>
  http.post(`/tasks/${taskId}/checklist`, { content }).then(data);
export const updateChecklistItem = (taskId, itemId, body) =>
  http.patch(`/tasks/${taskId}/checklist/${itemId}`, body).then(data);
export const deleteChecklistItem = (taskId, itemId) =>
  http.delete(`/tasks/${taskId}/checklist/${itemId}`).then(data);
