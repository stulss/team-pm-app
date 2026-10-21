import { describe, it, expect } from 'vitest';
// 클라이언트의 순수 함수를 서버 테스트 러너로 검증한다.
import { buildThreads } from '../../../client/src/utils/threads.js';

const c = (id, parentId = null) => ({ id, parentId });

describe('buildThreads', () => {
  it('답글을 원 댓글 아래로 묶고 작성순을 유지한다', () => {
    const flat = [c('a'), c('b'), c('a1', 'a'), c('b1', 'b'), c('a2', 'a'), c('d')];
    const threads = buildThreads(flat);
    expect(threads.map((t) => t.comment.id)).toEqual(['a', 'b', 'd']);
    expect(threads[0].replies.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(threads[1].replies.map((r) => r.id)).toEqual(['b1']);
    expect(threads[2].replies).toEqual([]);
  });

  it('원 댓글을 찾을 수 없는 답글은 최상위로 올려 사라지지 않게 한다', () => {
    const threads = buildThreads([c('x', 'missing'), c('y')]);
    expect(threads.map((t) => t.comment.id)).toEqual(['x', 'y']);
  });

  it('빈 배열은 빈 스레드', () => {
    expect(buildThreads([])).toEqual([]);
  });
});
