// express-rate-limit 용 Redis 저장소를 "처음 쓰일 때" Redis 가 준비된 뒤에 만든다.
//
// 왜 필요한가: rate-limit-redis 는 저장소를 초기화할 때(리미터 생성 시점) Lua 스크립트를 Redis 에 올린다.
// 서버리스 콜드 스타트에서는 그 시점에 Redis 연결이 아직 안 돼 있어 초기화가 실패하고, 실패한 결과가 저장돼
// 이후 모든 요청이 오류가 된다(passOnStoreError 로 통과는 되지만 한도가 사실상 꺼진다).
// 그래서 연결이 준비될 때까지 기다린 다음 저장소를 만들고, 실패하면 다음 요청에서 다시 시도한다.
export class LazyRedisStore {
  // express-rate-limit 가 요구하는 속성: 이 저장소는 여러 인스턴스가 공유한다.
  localKeys = false;

  /**
   * @param {{ getReadyClient: () => Promise<unknown>, createStore: (client: unknown, prefix: string) => any, prefix: string }} deps
   */
  constructor({ getReadyClient, createStore, prefix }) {
    this.getReadyClient = getReadyClient;
    this.createStore = createStore;
    this.prefix = prefix;
    this.inner = null;
    this.pending = null;
    this.options = null;
  }

  init(options) {
    this.options = options;
  }

  async resolve() {
    if (this.inner) return this.inner;
    this.pending ??= (async () => {
      const client = await this.getReadyClient(); // 준비되지 않으면 throw → 이번 요청은 통과(fail-open)
      const store = this.createStore(client, this.prefix);
      await store.init?.(this.options); // 이 시점엔 연결돼 있으므로 스크립트 로드가 성공한다
      this.inner = store;
      return store;
    })().finally(() => {
      this.pending = null; // 실패해도 다음 요청이 처음부터 다시 시도한다
    });
    return this.pending;
  }

  async increment(key) {
    return (await this.resolve()).increment(key);
  }

  async decrement(key) {
    return (await this.resolve()).decrement(key);
  }

  async resetKey(key) {
    return (await this.resolve()).resetKey(key);
  }
}
