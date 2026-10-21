import { http } from './http.js';

const data = (res) => res.data;

export const listDependencies = (taskId) => http.get(`/tasks/${taskId}/dependencies`).then(data);
export const addDependency = (taskId, dependsOnId) =>
  http.post(`/tasks/${taskId}/dependencies`, { dependsOnId }).then(data);
export const removeDependency = (taskId, dependsOnId) =>
  http.delete(`/tasks/${taskId}/dependencies/${dependsOnId}`).then(data);
