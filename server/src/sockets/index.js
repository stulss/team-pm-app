import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';

// 인스턴스 식별자 — 스파이크에서 서로 다른 인스턴스 간 전달을 확인하는 데 사용.
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

  // ---- M0 스파이크: 실제 기능 이벤트가 생기면(M5) 제거 ----
  io.on('connection', (socket) => {
    socket.emit('spike:hello', { instanceId, socketId: socket.id });
    socket.on('spike:send', (text) => {
      io.emit('spike:message', {
        text: String(text).slice(0, 200),
        fromInstance: instanceId,
        at: new Date().toISOString(),
      });
    });
  });

  return io;
}
