import { http } from './http.js';

const data = (res) => res.data;

export const createShareLink = (projectId, expiresInDays) =>
  http.post(`/projects/${projectId}/share-links`, { expiresInDays }).then(data);
export const listShareLinks = (projectId) =>
  http.get(`/projects/${projectId}/share-links`).then(data);
export const revokeShareLink = (projectId, linkId) =>
  http.delete(`/projects/${projectId}/share-links/${linkId}`);

// 공개(로그인 불필요) 조회. 이 호출이 401 을 받아도 로그인 갱신을 시도하지 않도록 /auth/ 가 아닌 경로지만
// 서버가 401 을 내지 않는다(없는 링크는 404).
export const getShared = (token, { before, limit = 30 } = {}) =>
  http.get(`/shared/${encodeURIComponent(token)}`, { params: { before, limit } }).then(data);

export const shareUrl = (token) => `${window.location.origin}/share/${token}`;
