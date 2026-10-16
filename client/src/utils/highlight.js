import { createElement } from 'react';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 텍스트에서 검색어와 일치하는 부분(대소문자 무시)만 <mark> 로 감싼다. HTML 로 해석하지 않는다.
export function highlight(text, q) {
  if (!text || !q) return text;
  const pattern = new RegExp(`(${escapeRegExp(q)})`, 'gi');
  const lower = q.toLowerCase();
  return text
    .split(pattern)
    .map((part, i) =>
      part.toLowerCase() === lower ? createElement('mark', { key: i }, part) : part,
    );
}
