import { describe, it, expect } from 'vitest';
// 클라이언트의 순수 함수를 서버 테스트 러너로 검증한다(DOM 불필요).
import { activeMentionIds, renderWithMentions } from '../../../client/src/utils/mentions.js';

const kim = { id: 'u1', name: '김' };
const kimCs = { id: 'u2', name: '김철수' };

describe('activeMentionIds', () => {
  it('본문에 @이름 이 남아 있는 멘션만 고른다 (지운 멘션은 제외)', () => {
    expect(activeMentionIds('@김 안녕', [kim, kimCs])).toEqual(['u1']);
    expect(activeMentionIds('@김철수 안녕', [kimCs])).toEqual(['u2']);
    expect(activeMentionIds('멘션을 지웠어요', [kim, kimCs])).toEqual([]);
  });
});

describe('renderWithMentions', () => {
  it('멘션이 없으면 본문 문자열을 그대로 돌려준다', () => {
    expect(renderWithMentions('그냥 글', [])).toBe('그냥 글');
    expect(renderWithMentions('그냥 글')).toBe('그냥 글');
  });

  it('멘션된 @이름 만 span.mention 으로 감싸고 나머지는 문자열로 둔다', () => {
    const parts = renderWithMentions('안녕 @김철수 님, 확인 부탁', [kimCs]);
    const spans = parts.filter((p) => typeof p !== 'string');
    expect(spans).toHaveLength(1);
    expect(spans[0].type).toBe('span');
    expect(spans[0].props).toMatchObject({ className: 'mention', children: '@김철수' });
    expect(parts.filter((p) => typeof p === 'string').join('')).toBe('안녕  님, 확인 부탁');
  });

  it('앞부분이 같은 이름이 있으면 긴 이름이 우선한다', () => {
    const parts = renderWithMentions('@김철수 와 @김', [kim, kimCs]);
    const marked = parts.filter((p) => typeof p !== 'string').map((p) => p.props.children);
    expect(marked).toEqual(['@김철수', '@김']);
  });

  it('정규식 특수문자가 들어간 이름도 안전하게 처리한다', () => {
    const odd = { id: 'u3', name: 'a.b*(c)' };
    const parts = renderWithMentions('hi @a.b*(c) and @axb', [odd]);
    const marked = parts.filter((p) => typeof p !== 'string').map((p) => p.props.children);
    expect(marked).toEqual(['@a.b*(c)']);
  });

  it('멘션되지 않은 사람의 @이름 은 강조하지 않고, HTML 은 해석하지 않는다', () => {
    const parts = [renderWithMentions('@누군가 <b>굵게</b>', [kim])].flat();
    expect(parts.every((p) => typeof p === 'string')).toBe(true);
    expect(parts.join('')).toBe('@누군가 <b>굵게</b>');
  });
});
