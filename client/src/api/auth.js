import { http } from './http.js';

export const verifyEmail = (token) => http.post('/auth/verify-email', { token });
export const resendVerification = (email) => http.post('/auth/resend-verification', { email });
export const forgotPassword = (email) => http.post('/auth/forgot-password', { email });
export const resetPassword = (token, password) =>
  http.post('/auth/reset-password', { token, password });

export const errorCode = (err) => err?.response?.data?.error?.code;
