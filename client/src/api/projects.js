import { http } from './http.js';

const data = (res) => res.data;

export const listProjects = (params) => http.get('/projects', { params }).then(data);
export const getProject = (id) => http.get(`/projects/${id}`).then(data);
export const createProject = (body) => http.post('/projects', body).then(data);
export const updateProject = (id, body) => http.patch(`/projects/${id}`, body).then(data);
export const deleteProject = (id) => http.delete(`/projects/${id}`);
export const addProjectMember = (id, userId) =>
  http.post(`/projects/${id}/members`, { userId }).then(data);
export const removeProjectMember = (id, userId) => http.delete(`/projects/${id}/members/${userId}`);

// 화면 표시용 권한 판단. 서버가 최종 검사를 하므로 버튼 노출 여부에만 쓴다.
export const canManageProject = (user, project) =>
  user.role === 'admin' || (user.role === 'manager' && project.ownerId === user.id);
