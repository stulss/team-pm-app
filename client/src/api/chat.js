import { http } from './http.js';

const data = (res) => res.data;

// before: 이전 페이지의 마지막 seq(커서). 응답은 최신순이다.
export const listChat = (projectId, { before, limit = 50 } = {}) =>
  http.get(`/projects/${projectId}/chat`, { params: { before, limit } }).then(data);
export const sendChat = (projectId, body, mentionIds = []) =>
  http.post(`/projects/${projectId}/chat`, { body, mentionIds }).then(data);
export const deleteChat = (projectId, messageId) =>
  http.delete(`/projects/${projectId}/chat/${messageId}`);
// on=true 면 반응을 달고, false 면 거둔다. 갱신된 메시지를 돌려준다.
export const reactChat = (projectId, messageId, key, on) =>
  http[on ? 'put' : 'delete'](`/projects/${projectId}/chat/${messageId}/reactions/${key}`).then(
    data,
  );
