import http from 'node:http';
import { Duplex } from 'node:stream';

// 포트를 열지 않고 같은 프로세스의 Express 앱에 진짜 HTTP 요청을 보낸다.
// 두 끝을 서로 이은 메모리 소켓 한 쌍을 만들어, 한쪽은 http.Server 의 연결로 넘기고 다른 쪽은 http.request 가 쓴다.
// 그래서 파서·미들웨어·검증·권한·실시간 이벤트가 바깥에서 오는 요청과 똑같이 동작한다
// (light-my-request 같은 주입 도구는 Express 의 요청 프로토타입을 프로세스 전역에서 바꿔 서비스 중인 앱에 쓸 수 없다).

class MemorySocket extends Duplex {
  constructor() {
    super();
    this.peer = null;
    this.remoteAddress = '127.0.0.1';
  }

  _read() {}

  _write(chunk, encoding, callback) {
    this.peer.push(chunk);
    callback();
  }

  _final(callback) {
    this.peer.push(null);
    callback();
  }

  _destroy(err, callback) {
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    callback(err);
  }

  // net.Socket 이 가진 메서드 중 http 모듈이 부르는 것들(할 일이 없다)
  setTimeout() {
    return this;
  }
  setNoDelay() {}
  setKeepAlive() {}
  ref() {}
  unref() {}
}

const servers = new WeakMap(); // app → 연결을 받는 http.Server (listen 하지 않는다)
const serverFor = (app) => {
  if (!servers.has(app)) servers.set(app, http.createServer(app));
  return servers.get(app);
};

const TIMEOUT_MS = 15_000;

// → { status, body(문자열) }
export function inProcessRequest(app, { method, path, headers = {}, body, ip }) {
  return new Promise((resolve, reject) => {
    const client = new MemorySocket();
    const server = new MemorySocket();
    client.peer = server;
    server.peer = client;
    if (ip) headers = { ...headers, 'x-forwarded-for': ip }; // 서버는 trust proxy 1 로 이 값을 req.ip 로 쓴다
    serverFor(app).emit('connection', server);

    // 요청마다 새 에이전트: 연결을 만들 때 위의 메모리 소켓을 돌려주고 재사용하지 않는다.
    const agent = new http.Agent({ keepAlive: false });
    agent.createConnection = () => client;

    const payload = body === undefined ? undefined : Buffer.from(body);
    const req = http.request(
      {
        method,
        path,
        agent,
        headers: {
          ...headers,
          host: 'internal',
          connection: 'close',
          ...(payload ? { 'content-length': payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('internal request timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
