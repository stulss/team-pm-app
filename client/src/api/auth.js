import { http } from './http.js';

export const forgotPassword = (email) => http.post('/auth/forgot-password', { email });
export const resetPassword = (token, password) =>
  http.post('/auth/reset-password', { token, password });
