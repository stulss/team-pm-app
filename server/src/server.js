import http from 'node:http';
import { app } from './app.js';
import { attachSockets } from './sockets/index.js';
import { registerIo } from './sockets/emitter.js';
import { logger } from './utils/logger.js';

// Vercel Function 진입점과 로컬 개발이 공유하는 http.Server.
export const server = http.createServer(app);

// 소켓(Redis 연결 포함) 초기화는 비동기라 서버 객체 생성 후 시작한다.
export const ready = attachSockets(server).catch((err) => {
  logger.error({ err }, 'socket init failed');
});
// REST 핸들러가 emit 할 수 있도록 io 를 등록한다. (초기화에 실패하면 undefined → emit 은 no-op)
registerIo(ready);

export default server;
