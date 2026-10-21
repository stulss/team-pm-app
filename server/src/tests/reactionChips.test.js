import { describe, it, expect } from 'vitest';
// 클라이언트의 순수 함수를 서버 테스트 러너로 검증한다.
import { REACTIONS, reactionChips } from '../../../client/src/constants/reactions.js';
import { REACTION_KEYS } from '../utils/reactions.js';

describe('반응 키 목록', () => {
  it('클라이언트 표시 목록이 서버가 허용하는 키와 정확히 같다', () => {
    expect(REACTIONS.map((r) => r.key)).toEqual(REACTION_KEYS);
    for (const r of REACTIONS) {
      expect(r.emoji).toBeTruthy();
      expect(r.label).toBeTruthy();
    }
  });
});

describe('reactionChips', () => {
  const me = 'u-me';
  const reactions = [
    {
      key: 'thumbs_up',
      users: [
        { id: 'u-a', name: '앨리스' },
        { id: me, name: '나' },
      ],
    },
    { key: 'heart', users: [{ id: 'u-a', name: '앨리스' }] },
  ];

  it('개수·내가 눌렀는지·이름 목록을 계산한다', () => {
    const chips = reactionChips(reactions, me);
    expect(chips.map((c) => [c.key, c.count, c.mine, c.names])).toEqual([
      ['thumbs_up', 2, true, '앨리스, 나'],
      ['heart', 1, false, '앨리스'],
    ]);
    expect(chips[0]).toMatchObject({ emoji: '👍', label: '좋아요' });
  });

  it('알 수 없는 키와 빈 사용자 목록은 버리고, 값이 없어도 안전하다', () => {
    expect(reactionChips([{ key: 'fire', users: [{ id: 'x', name: 'x' }] }], me)).toEqual([]);
    expect(reactionChips([{ key: 'heart', users: [] }], me)).toEqual([]);
    expect(reactionChips(undefined, me)).toEqual([]);
    expect(reactionChips([], me)).toEqual([]);
  });
});
