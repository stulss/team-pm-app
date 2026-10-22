import { http } from './http.js';

const data = (res) => res.data;

export const listApiTokens = () => http.get('/users/me/api-tokens').then((res) => res.data.data);
// 응답의 token 값은 이때 한 번만 보인다.
export const createApiToken = (body) => http.post('/users/me/api-tokens', body).then(data);
export const revokeApiToken = (id) => http.delete(`/users/me/api-tokens/${id}`);
