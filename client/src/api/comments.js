import { http } from './http.js';

const data = (res) => res.data;

export const listComments = (taskId) => http.get(`/tasks/${taskId}/comments`).then(data);
// parentId 가 있으면 그 댓글에 대한 답글이다(한 단계만).
export const createComment = (taskId, body, mentionIds = [], parentId) =>
  http.post(`/tasks/${taskId}/comments`, { body, mentionIds, parentId }).then(data);
export const updateComment = (id, body, mentionIds = []) =>
  http.patch(`/comments/${id}`, { body, mentionIds }).then(data);
export const deleteComment = (id) => http.delete(`/comments/${id}`);
// on=true 면 반응을 달고, false 면 거둔다. 갱신된 댓글을 돌려준다.
export const reactComment = (id, key, on) =>
  http[on ? 'put' : 'delete'](`/comments/${id}/reactions/${key}`).then(data);
