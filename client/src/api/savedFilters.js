import { http } from './http.js';

const data = (res) => res.data;

export const listSavedFilters = (projectId) =>
  http.get(`/projects/${projectId}/saved-filters`).then(data);
export const createSavedFilter = (projectId, body) =>
  http.post(`/projects/${projectId}/saved-filters`, body).then(data);
export const deleteSavedFilter = (projectId, filterId) =>
  http.delete(`/projects/${projectId}/saved-filters/${filterId}`);
