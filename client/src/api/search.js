import { http } from './http.js';

export const search = (q, { type = 'all', limit = 8 } = {}) =>
  http.get('/search', { params: { q, type, limit } }).then((res) => res.data);
