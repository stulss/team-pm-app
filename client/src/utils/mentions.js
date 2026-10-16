import { createElement } from 'react';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 본문에 `@이름` 이 아직 남아 있는 멘션의 ID 만 서버로 보낸다(지운 멘션은 제외).
export const activeMentionIds = (text, mentions) =>
  mentions.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id);

// 본문을 텍스트로 유지한 채 멘션된 `@이름` 만 강조한다(HTML 로 해석하지 않는다).
// 긴 이름부터 맞춰, "@김" 과 "@김철수" 처럼 앞부분이 같은 이름이 있어도 긴 쪽이 우선한다.
export function renderWithMentions(body, mentions = []) {
  if (!mentions.length) return body;
  const names = [...new Set(mentions.map((m) => `@${m.name}`))].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${names.map(escapeRegExp).join('|')})`, 'g');
  return body
    .split(pattern)
    .map((part, i) =>
      names.includes(part) ? createElement('span', { key: i, className: 'mention' }, part) : part,
    );
}
