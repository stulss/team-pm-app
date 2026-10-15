import { logger } from '../utils/logger.js';

// REST 서비스/라우트에서 호출하는 emit 헬퍼.
// 변경은 REST 로만 일어나고, 소켓은 DB 커밋 이후의 푸시 전용이다.
// Redis adapter 덕분에 REST 를 처리한 인스턴스와 소켓이 붙은 인스턴스가 달라도 전달된다.
//
// io 가 아직 준비되지 않았거나(테스트 등) 실패해도 REST 응답을 깨뜨리지 않는다.

let ioPromise = null;

export function registerIo(promise) {
  ioPromise = promise;
}

async function withIo(fn) {
  try {
    const io = await ioPromise;
    if (io) await fn(io);
  } catch (err) {
    logger.error({ err: err.message }, 'socket emit failed');
  }
}

export const projectRoom = (projectId) => `project:${projectId}`;
export const userRoom = (userId) => `user:${userId}`;

// 프로젝트 방의 모든 소켓에 보낸다. 요청자의 소켓(X-Socket-Id 헤더)은 제외한다:
// 요청자는 이미 응답으로 최신 상태를 받았기 때문이다.
export function emitToProject(req, projectId, event, payload) {
  const socketId = req?.get?.('x-socket-id');
  return withIo((io) => {
    let target = io.to(projectRoom(projectId));
    if (socketId) target = target.except(socketId);
    target.emit(event, payload);
  });
}

export function emitToUser(userId, event, payload) {
  return withIo((io) => io.to(userRoom(userId)).emit(event, payload));
}

// 프로젝트에서 제거된 사용자의 모든 소켓을 해당 방에서 내보낸다. (더 이상 이벤트를 받지 못하게)
export function removeUserFromProjectRoom(userId, projectId) {
  return withIo((io) => io.in(userRoom(userId)).socketsLeave(projectRoom(projectId)));
}

// 역할 변경·비활성화 후에는 연결을 끊는다. 클라이언트는 재연결하면서 권한을 다시 검증받는다.
export function disconnectUser(userId) {
  return withIo((io) => io.in(userRoom(userId)).disconnectSockets(true));
}
