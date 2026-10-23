import { http } from './http.js';

const data = (res) => res.data;

export const listRecurrences = (projectId) =>
  http.get(`/projects/${projectId}/recurrences`).then(data);
export const createRecurrence = (projectId, body) =>
  http.post(`/projects/${projectId}/recurrences`, body).then(data);
export const updateRecurrence = (projectId, id, body) =>
  http.patch(`/projects/${projectId}/recurrences/${id}`, body).then(data);
export const deleteRecurrence = (projectId, id) =>
  http.delete(`/projects/${projectId}/recurrences/${id}`);
