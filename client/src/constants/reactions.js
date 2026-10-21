// 서버가 허용하는 반응 키(마이그레이션 017 의 CHECK 와 같은 목록)와 화면 표시.
export const REACTIONS = [
  { key: 'thumbs_up', emoji: '👍', label: '좋아요' },
  { key: 'heart', emoji: '❤️', label: '하트' },
  { key: 'laugh', emoji: '😄', label: '웃음' },
  { key: 'party', emoji: '🎉', label: '축하' },
  { key: 'wow', emoji: '😮', label: '놀람' },
  { key: 'thanks', emoji: '🙏', label: '감사' },
  { key: 'eyes', emoji: '👀', label: '확인 중' },
  { key: 'check', emoji: '✅', label: '완료' },
];

export const REACTION_BY_KEY = Object.fromEntries(REACTIONS.map((r) => [r.key, r]));

// 서버 응답의 reactions([{ key, users }])를 화면용으로 바꾼다. 알 수 없는 키는 버린다.
export function reactionChips(reactions, meId) {
  return (reactions ?? [])
    .filter((r) => REACTION_BY_KEY[r.key] && r.users.length > 0)
    .map((r) => ({
      ...REACTION_BY_KEY[r.key],
      count: r.users.length,
      mine: r.users.some((u) => u.id === meId),
      names: r.users.map((u) => u.name).join(', '),
    }));
}
