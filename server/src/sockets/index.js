import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';
import { authenticateSocket } from './auth.js';
import { userRoom } from './emitter.js';
import { registerRoomHandlers } from './rooms.js';
import { logger } from '../utils/logger.js';

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
    try {
      const pub = createClient({ url: env.REDIS_URL });
      const sub = pub.duplicate();
      pub.on('error', (e) => logger.error({ err: e.message }, 'redis pub error'));
      sub.on('error', (e) => logger.error({ err: e.message }, 'redis sub error'));
      await Promise.all([pub.connect(), sub.connect()]);
      io.adapter(createAdapter(pub, sub));
      logger.info({ instanceId }, 'socket redis adapter on');
    } catch (err) {
      // Redis 장애로 실시간 전체가 꺼지지 않게 한다. 다중 인스턴스 간 전달만 포기하고 이 인스턴스 안에서는 동작한다.
      logger.error(
        { err: err.message, instanceId },
        'socket redis adapter failed, single instance mode',
      );
    }
  } else {
    logger.warn({ instanceId }, 'REDIS_URL not set, socket single instance mode');
  }

  io.use(authenticateSocket);
  io.on('connection', (socket) => {
    // 개인 룸: 알림(M7)과 권한 회수(연결 끊기)에 쓴다. 프로젝트 룸은 멤버십 검증 후 입장한다.
    socket.join(userRoom(socket.data.user.id));
    registerRoomHandlers(socket);
  });

  return io;
}
