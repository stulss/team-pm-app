import { describe, it, expect } from 'vitest';
// 클라이언트의 순수 함수를 서버 테스트 러너로 검증한다(DOM 불필요).
import { highlight } from '../../../client/src/utils/highlight.js';

const marked = (parts) => parts.filter((p) => typeof p !== 'string').map((p) => p.props.children);

describe('highlight', () => {
  it('검색어와 일치하는 부분(대소문자 무시)만 mark 로 감싼다', () => {
    const parts = highlight('Login 화면, login 버튼', 'LOGIN');
    expect(marked(parts)).toEqual(['Login', 'login']);
    expect(parts.filter((p) => typeof p !== 'string').every((p) => p.type === 'mark')).toBe(true);
    expect(parts.map((p) => (typeof p === 'string' ? p : p.props.children)).join('')).toBe(
      'Login 화면, login 버튼',
    );
  });

  it('정규식 특수문자가 들어간 검색어도 글자 그대로 찾는다', () => {
    expect(marked(highlight('a.b*c (a+b) axb', 'a.b*c'))).toEqual(['a.b*c']);
    expect(marked(highlight('100% 달성', '100%'))).toEqual(['100%']);
  });

  it('HTML 은 해석하지 않고 문자열로 둔다', () => {
    const parts = highlight('<b>굵게</b> 태그', '태그');
    expect(parts.join('').startsWith('<b>굵게</b> ')).toBe(true);
    expect(marked(parts)).toEqual(['태그']);
  });

  it('빈 값은 그대로 돌려준다', () => {
    expect(highlight('', 'x')).toBe('');
    expect(highlight(null, 'x')).toBeNull();
    expect(highlight('본문', '')).toBe('본문');
  });
});
