import { http } from './http.js';

const data = (res) => res.data;

export const listProjects = (params) => http.get('/projects', { params }).then(data);
export const getProject = (id) => http.get(`/projects/${id}`).then(data);
export const createProject = (body) => http.post('/projects', body).then(data);
export const updateProject = (id, body) => http.patch(`/projects/${id}`, body).then(data);
export const deleteProject = (id) => http.delete(`/projects/${id}`);
// body: { userId } 또는 { email }
export const addProjectMember = (id, body) => http.post(`/projects/${id}/members`, body).then(data);
export const removeProjectMember = (id, userId) => http.delete(`/projects/${id}/members/${userId}`);

// 화면 표시용 권한 판단. 서버가 최종 검사를 하므로 버튼 노출 여부에만 쓴다.
export const canManageProject = (user, project) =>
  user.role === 'admin' || project.ownerId === user.id;

// 사용자 목록 검색은 Admin/Manager 만 가능하다. 그 외에는 이메일로 초대한다.
export const canSearchUsers = (user) => user.role === 'admin' || user.role === 'manager';
