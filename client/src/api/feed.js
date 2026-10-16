import { http } from './http.js';

export const getFeed = () => http.get('/feed').then((res) => res.data);
