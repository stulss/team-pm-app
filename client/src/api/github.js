import { http } from './http.js';

export const getGithub = (projectId) =>
  http.get(`/projects/${projectId}/github`).then((res) => res.data);
export const connectGithub = (projectId, body) =>
  http.put(`/projects/${projectId}/github`, body).then((res) => res.data);
export const rotateGithubSecret = (projectId) =>
  http.post(`/projects/${projectId}/github/rotate-secret`).then((res) => res.data);
export const disconnectGithub = (projectId) => http.delete(`/projects/${projectId}/github`);
export const listGithubLinks = (taskId) =>
  http.get(`/tasks/${taskId}/github-links`).then((res) => res.data.data);
