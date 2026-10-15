// Vercel Function 진입점. 모든 /api/* 요청은 vercel.json rewrite 로 여기로 온다.
export { default } from '../server/src/server.js';
