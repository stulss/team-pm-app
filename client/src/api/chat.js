import { http } from './http.js';

const data = (res) => res.data;

// before: 이전 페이지의 마지막 seq(커서). 응답은 최신순이다.
export const listChat = (projectId, { before, limit = 50 } = {}) =>
  http.get(`/projects/${projectId}/chat`, { params: { before, limit } }).then(data);
export const sendChat = (projectId, body) =>
  http.post(`/projects/${projectId}/chat`, { body }).then(data);
export const deleteChat = (projectId, messageId) =>
  http.delete(`/projects/${projectId}/chat/${messageId}`);
