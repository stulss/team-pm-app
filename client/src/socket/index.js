import { io } from 'socket.io-client';
import { getAccessToken, refreshSession, setSocketIdGetter } from '../api/http.js';

let socket = null;

// 로그인 중 하나의 소켓 연결을 공유한다. 재연결 때마다 최신 access 토큰으로 인증한다.
export function connectSocket() {
  if (socket) return socket;

  socket = io({
    path: '/api/socket.io',
    transports: ['websocket'], // Vercel 에서는 long-polling 이 동작하지 않는다
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnectionDelayMax: 10_000,
  });
  setSocketIdGetter(() => (socket?.connected ? socket.id : undefined));

  // 서버가 연결을 끊은 경우(역할 변경·권한 회수 등, reason: 'io server disconnect')에는
  // socket.io 가 자동 재연결하지 않는다. 직접 다시 연결해 권한을 다시 검증받고, 연결되면 구독 훅이 재조회한다.
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') setTimeout(() => socket?.connect(), 500);
  });

  // 미들웨어가 거부한 연결(access 토큰 만료)은 자동 재시도되지 않는다 → 토큰을 갱신하고 직접 다시 연결한다.
  socket.on('connect_error', async (err) => {
    if (err.message !== 'UNAUTHORIZED') return;
    try {
      await refreshSession();
      socket?.connect();
    } catch {
      /* 세션이 만료된 경우: 다음 API 호출에서 http 계층이 로그아웃 처리한다 */
    }
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  setSocketIdGetter(() => undefined);
}
