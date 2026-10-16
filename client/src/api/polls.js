import { http } from './http.js';

const data = (res) => res.data;

export const listPolls = (projectId) => http.get(`/projects/${projectId}/polls`).then(data);
export const createPoll = (projectId, body) =>
  http.post(`/projects/${projectId}/polls`, body).then(data);
export const votePoll = (projectId, pollId, optionIds) =>
  http.put(`/projects/${projectId}/polls/${pollId}/vote`, { optionIds }).then(data);
export const closePoll = (projectId, pollId) =>
  http.post(`/projects/${projectId}/polls/${pollId}/close`).then(data);
export const deletePoll = (projectId, pollId) =>
  http.delete(`/projects/${projectId}/polls/${pollId}`);
