import { http } from './http.js';

const data = (res) => res.data;

export const listProjectTasks = (projectId, params) =>
  http.get(`/projects/${projectId}/tasks`, { params }).then(data);
export const createTask = (projectId, body) =>
  http.post(`/projects/${projectId}/tasks`, body).then(data);
export const updateTask = (id, body) => http.patch(`/tasks/${id}`, body).then(data);
export const deleteTask = (id) => http.delete(`/tasks/${id}`);
export const listMyTasks = (params) => http.get('/tasks/mine', { params }).then(data);
export const moveTask = (id, body) => http.patch(`/tasks/${id}/move`, body).then(data);
export const getTask = (id) => http.get(`/tasks/${id}`).then(data);
