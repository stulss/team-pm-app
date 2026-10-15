import { http } from './http.js';

const data = (res) => res.data;

export const getProjectDashboard = (projectId) =>
  http.get(`/projects/${projectId}/dashboard`).then(data);
export const getOverallDashboard = () => http.get('/dashboard').then(data);
