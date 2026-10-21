import { http } from './http.js';

const data = (res) => res.data;

// 이름·비밀번호 변경. 비밀번호를 바꾸면 새 세션(accessToken)이 함께 온다.
export const updateMe = (body) => http.patch('/users/me', body).then(data);
export const updatePreferences = (patch) => http.patch('/users/me/preferences', patch).then(data);
export const listUsers = (params) => http.get('/users', { params }).then(data);
export const setUserRole = (id, role) => http.patch(`/users/${id}/role`, { role }).then(data);
export const setUserStatus = (id, isActive) =>
  http.patch(`/users/${id}/status`, { isActive }).then(data);
