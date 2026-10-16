import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { LazyRedisStore } from './lazyRedisStore.js';

const tooMany = (req, res) =>
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
  });

// 서버리스에서는 인스턴스마다 메모리가 따로라 메모리 저장소만으로는 한도가 인스턴스 수만큼 늘어난다.
// 운영에서는 Redis 에 카운트를 저장해 모든 인스턴스가 한도를 공유한다.
// - 명령은 연결이 안 된 동안 대기하지 않고 즉시 실패한다(요청이 Redis 때문에 멈추지 않게).
// - 저장소 오류 시에는 요청을 막지 않는다(fail-open, passOnStoreError). 레이트리밋 장애가 서비스 장애가 되면 안 된다.
// - 저장소는 Redis 연결이 준비된 뒤에 만든다(LazyRedisStore).
const READY_TIMEOUT_MS = 2000;
let redisClient = null;
let connecting = null;

function getReadyRedis() {
  if (redisClient?.isReady) return Promise.resolve(redisClient);
  if (!connecting) {
    const client = createClient({
      url: env.REDIS_URL,
      disableOfflineQueue: true,
      socket: { connectTimeout: 3000 },
    });
    client.on('error', (err) => logger.warn({ err: err.message }, 'rate-limit redis error'));
    redisClient = client;
    connecting = client.connect().catch((err) => {
      redisClient = null; // 다음 요청에서 새로 시도
      connecting = null;
      throw err;
    });
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('redis not ready')), READY_TIMEOUT_MS);
  });
  return Promise.race([connecting.then(() => redisClient), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

const redisStore = (prefix) =>
  env.REDIS_URL
    ? new LazyRedisStore({
        prefix,
        getReadyClient: getReadyRedis,
        createStore: (client, p) =>
          new RedisStore({ sendCommand: (...args) => client.sendCommand(args), prefix: p }),
      })
    : undefined; // 메모리 저장소(기본값)

const common = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany,
  passOnStoreError: true,
};

// 개발·테스트에서는 끈다(반복 실행하는 스모크/e2e 가 막히지 않게). 한도 동작은 tests/rateLimit.test.js 가 검증한다.
const defaultSkip = () => env.NODE_ENV !== 'production';

export function createLimiters({ skip = defaultSkip, useRedis = true } = {}) {
  const store = (prefix) => (useRedis ? redisStore(prefix) : undefined);
  return {
    // 로그인: IP + 이메일 기준 (무차별 대입 방지)
    login: rateLimit({
      ...common,
      windowMs: 15 * 60 * 1000,
      limit: 10,
      skip,
      store: store('rl:login:'),
      keyGenerator: (req) =>
        `${ipKeyGenerator(req.ip)}:${String(req.body?.email ?? '').toLowerCase()}`,
    }),
    // 가입: IP 기준
    register: rateLimit({
      ...common,
      windowMs: 60 * 60 * 1000,
      limit: 20,
      skip,
      store: store('rl:register:'),
      keyGenerator: (req) => ipKeyGenerator(req.ip),
    }),
    // 인증·재설정 메일 요청: IP + 이메일 기준(메일 폭탄과 발송 한도 소진 방지)
    mail: rateLimit({
      ...common,
      windowMs: 60 * 60 * 1000,
      limit: 10,
      skip,
      store: store('rl:mail:'),
      keyGenerator: (req) =>
        `${ipKeyGenerator(req.ip)}:${String(req.body?.email ?? '').toLowerCase()}`,
    }),
    // 공개 공유 링크 조회(로그인 없음): IP 기준
    shared: rateLimit({
      ...common,
      windowMs: 60 * 1000,
      limit: 120,
      skip,
      store: store('rl:shared:'),
      keyGenerator: (req) => ipKeyGenerator(req.ip),
    }),
    // 채팅 메시지 보내기: 사용자 기준 분당 30건(도배 방지). authenticate 뒤에서만 쓴다.
    chat: rateLimit({
      ...common,
      windowMs: 60 * 1000,
      limit: 30,
      skip,
      store: store('rl:chat:'),
      keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
    }),
    // 일반 API: IP 기준. 같은 사무실(NAT)의 여러 사용자가 함께 쓸 수 있도록 넉넉하게 둔다.
    api: rateLimit({
      ...common,
      windowMs: 60 * 1000,
      limit: 600,
      skip: (req, res) => skip(req, res) || req.path === '/health',
      store: store('rl:api:'),
      keyGenerator: (req) => ipKeyGenerator(req.ip),
    }),
  };
}

export const {
  login: loginLimiter,
  register: registerLimiter,
  mail: mailLimiter,
  shared: sharedLimiter,
  chat: chatSendLimiter,
  api: apiLimiter,
} = createLimiters();
