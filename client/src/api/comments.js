import { http } from './http.js';

const data = (res) => res.data;

export const listComments = (taskId) => http.get(`/tasks/${taskId}/comments`).then(data);
export const createComment = (taskId, body) =>
  http.post(`/tasks/${taskId}/comments`, { body }).then(data);
export const updateComment = (id, body) => http.patch(`/comments/${id}`, { body }).then(data);
export const deleteComment = (id) => http.delete(`/comments/${id}`);
