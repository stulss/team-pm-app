import { http } from './http.js';

const data = (res) => res.data;

export const listComments = (taskId) => http.get(`/tasks/${taskId}/comments`).then(data);
export const createComment = (taskId, body, mentionIds = []) =>
  http.post(`/tasks/${taskId}/comments`, { body, mentionIds }).then(data);
export const updateComment = (id, body, mentionIds = []) =>
  http.patch(`/comments/${id}`, { body, mentionIds }).then(data);
export const deleteComment = (id) => http.delete(`/comments/${id}`);
