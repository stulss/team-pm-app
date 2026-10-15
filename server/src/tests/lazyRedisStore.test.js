import { describe, it, expect, vi } from 'vitest';
import { LazyRedisStore } from '../middleware/lazyRedisStore.js';

function setup({ readyAfter = 0 } = {}) {
  let attempts = 0;
  const inner = {
    init: vi.fn(async () => {}),
    increment: vi.fn(async (key) => ({ totalHits: 1, resetTime: new Date(), key })),
    decrement: vi.fn(async () => {}),
    resetKey: vi.fn(async () => {}),
  };
  const getReadyClient = vi.fn(async () => {
    attempts += 1;
    if (attempts <= readyAfter) throw new Error('redis not ready');
    return { fake: 'client' };
  });
  const createStore = vi.fn(() => inner);
  const store = new LazyRedisStore({ getReadyClient, createStore, prefix: 'rl:test:' });
  return { store, inner, getReadyClient, createStore };
}

describe('LazyRedisStore', () => {
  it('처음 쓰이기 전에는 Redis 연결도 저장소 생성도 하지 않는다', () => {
    const { store, getReadyClient, createStore } = setup();
    store.init({ windowMs: 1000 });
    expect(getReadyClient).not.toHaveBeenCalled();
    expect(createStore).not.toHaveBeenCalled();
  });

  it('첫 사용 시 연결 준비를 기다린 뒤 저장소를 만들고 init 옵션을 넘기고 위임한다', async () => {
    const { store, inner, createStore } = setup();
    store.init({ windowMs: 60_000 });
    const res = await store.increment('1.1.1.1');
    expect(res.key).toBe('1.1.1.1');
    expect(createStore).toHaveBeenCalledWith({ fake: 'client' }, 'rl:test:');
    expect(inner.init).toHaveBeenCalledWith({ windowMs: 60_000 });

    await store.decrement('1.1.1.1');
    await store.resetKey('1.1.1.1');
    expect(inner.decrement).toHaveBeenCalledWith('1.1.1.1');
    expect(inner.resetKey).toHaveBeenCalledWith('1.1.1.1');
  });

  it('저장소는 한 번만 만들고 재사용한다 (동시 호출 포함)', async () => {
    const { store, createStore, inner } = setup();
    store.init({ windowMs: 1000 });
    await Promise.all([store.increment('a'), store.increment('b'), store.increment('c')]);
    await store.increment('d');
    expect(createStore).toHaveBeenCalledTimes(1);
    expect(inner.init).toHaveBeenCalledTimes(1);
    expect(inner.increment).toHaveBeenCalledTimes(4);
  });

  it('연결이 아직 안 됐으면 이번 요청은 오류(→ fail-open)이고, 다음 요청에서 다시 시도해 복구한다', async () => {
    const { store, createStore } = setup({ readyAfter: 2 });
    store.init({ windowMs: 1000 });
    await expect(store.increment('x')).rejects.toThrow('redis not ready');
    await expect(store.increment('x')).rejects.toThrow('redis not ready');
    expect(createStore).not.toHaveBeenCalled();

    const ok = await store.increment('x'); // 세 번째 시도에서 준비됨
    expect(ok.totalHits).toBe(1);
    expect(createStore).toHaveBeenCalledTimes(1);
  });

  it('저장소 init 이 실패해도 다음 요청에서 처음부터 다시 시도한다', async () => {
    const { store, inner } = setup();
    inner.init.mockRejectedValueOnce(new Error('script load failed'));
    store.init({ windowMs: 1000 });
    await expect(store.increment('x')).rejects.toThrow('script load failed');
    expect((await store.increment('x')).totalHits).toBe(1);
  });

  it('여러 인스턴스가 공유하는 저장소임을 알린다(localKeys=false)', () => {
    expect(setup().store.localKeys).toBe(false);
  });
});
