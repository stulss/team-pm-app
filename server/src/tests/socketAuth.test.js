import { describe, it, expect, vi, beforeEach } from 'vitest';
import { store, reset } from './helpers/memoryRepos.js';
import { register } from './helpers/setup.js';

vi.mock('../config/db.js', () => ({
  query: vi.fn(),
  pool: {},
  withTransaction: (fn) => fn({}),
}));
vi.mock('../modules/users/repository.js', async () => ({
  ...(await vi.importActual('../modules/users/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).usersRepo,
}));
vi.mock(
  '../modules/auth/repository.js',
  async () => (await import('./helpers/memoryRepos.js')).authRepo,
);

const { app } = await import('../app.js');
const { authenticateSocket } = await import('../sockets/auth.js');

const connect = (auth) => {
  const socket = { handshake: { auth }, data: {} };
  const next = vi.fn();
  return authenticateSocket(socket, next).then(() => ({ socket, next }));
};

let token;
beforeEach(async () => {
  reset();
  const { res } = await register(app);
  token = res.body.accessToken;
});

describe('소켓 연결 인증', () => {
  it('유효한 access 토큰이면 연결을 허용하고 사용자 정보를 싣는다', async () => {
    const { socket, next } = await connect({ token });
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user).toMatchObject({ role: 'admin' });
    expect(socket.data.user.id).toBe(store.users[0].id);
  });

  it.each([
    ['토큰 없음', undefined],
    ['빈 auth', {}],
    ['잘못된 토큰', { token: 'garbage' }],
    ['문자열이 아닌 토큰', { token: 123 }],
  ])('거부: %s', async (_label, auth) => {
    const { socket, next } = await connect(auth);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toBe('UNAUTHORIZED');
    expect(socket.data.user).toBeUndefined();
  });

  it('비활성화된 사용자는 유효한 토큰이 있어도 거부한다', async () => {
    store.users[0].is_active = false;
    const { next } = await connect({ token });
    expect(next.mock.calls[0][0].message).toBe('UNAUTHORIZED');
  });

  it('삭제된 사용자의 토큰은 거부한다', async () => {
    store.users.length = 0;
    const { next } = await connect({ token });
    expect(next.mock.calls[0][0].message).toBe('UNAUTHORIZED');
  });
});
