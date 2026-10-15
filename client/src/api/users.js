import { http } from './http.js';

const data = (res) => res.data;

export const listUsers = (params) => http.get('/users', { params }).then(data);
export const setUserRole = (id, role) => http.patch(`/users/${id}/role`, { role }).then(data);
export const setUserStatus = (id, isActive) =>
  http.patch(`/users/${id}/status`, { isActive }).then(data);
