import http from 'node:http';
import { app } from './app.js';
import { attachSockets } from './sockets/index.js';

// Vercel Function 진입점과 로컬 개발이 공유하는 http.Server.
export const server = http.createServer(app);

// 소켓(Redis 연결 포함) 초기화는 비동기라 서버 객체 생성 후 시작한다.
export const ready = attachSockets(server).catch((err) => {
  console.error('socket init failed', err);
});

export default server;
