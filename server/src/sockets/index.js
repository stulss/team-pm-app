import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';
import { authenticateSocket } from './auth.js';

// 인스턴스 식별자 — 로그에서 어느 인스턴스인지 구분하는 용도.
export const instanceId = randomUUID().slice(0, 8);

export async function attachSockets(httpServer) {
  const io = new Server(httpServer, {
    // 함수 경로(/api/*) 아래에 둔다. 클라이언트도 같은 path 를 사용해야 한다.
    path: '/api/socket.io',
    transports: ['websocket'],
    cors: env.CLIENT_ORIGIN ? { origin: env.CLIENT_ORIGIN, credentials: true } : undefined,
  });

  if (env.REDIS_URL) {
    const pub = createClient({ url: env.REDIS_URL });
    const sub = pub.duplicate();
    pub.on('error', (e) => console.error('redis pub error', e.message));
    sub.on('error', (e) => console.error('redis sub error', e.message));
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    console.log(`[socket] redis adapter on (instance ${instanceId})`);
  } else {
    console.warn(`[socket] REDIS_URL not set — single instance mode (instance ${instanceId})`);
  }

  io.use(authenticateSocket);
  io.on('connection', (socket) => {
    // 개인 알림 룸. 프로젝트 룸 입장(멤버십 검증)과 이벤트는 M5 에서 추가한다.
    socket.join(`user:${socket.data.user.id}`);
  });

  return io;
}
