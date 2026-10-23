import { describe, it, expect } from 'vitest';
import {
  extractClosedIssues,
  extractNumbers,
  extractNumbersFrom,
  normalizeRepo,
  prState,
  signBody,
  verifySignature,
  webhookSecret,
} from '../modules/github/parse.js';

describe('normalizeRepo', () => {
  it('owner/repo 와 여러 형태의 GitHub 주소를 owner/repo 로 정리한다', () => {
    expect(normalizeRepo('octo/hello')).toBe('octo/hello');
    expect(normalizeRepo(' octo/hello ')).toBe('octo/hello');
    expect(normalizeRepo('https://github.com/octo/hello')).toBe('octo/hello');
    expect(normalizeRepo('http://www.github.com/octo/hello.git')).toBe('octo/hello');
    expect(normalizeRepo('github.com/octo/hello/pull/12')).toBe('octo/hello');
    expect(normalizeRepo('Octo-Org/my.repo_1')).toBe('Octo-Org/my.repo_1');
  });

  it('형식이 틀리면 null', () => {
    expect(normalizeRepo('octo')).toBeNull();
    expect(normalizeRepo('')).toBeNull();
    expect(normalizeRepo('oc to/hello')).toBeNull();
    expect(normalizeRepo(`${'a'.repeat(100)}/${'b'.repeat(100)}`)).toBeNull();
  });
});

describe('extractNumbers', () => {
  it('프로젝트 키의 작업 번호를 대소문자 무시로 모두 찾고 중복 없이 정렬한다', () => {
    expect(extractNumbers('Fix TPM-12 and tpm-3, also TPM-12 again', 'TPM')).toEqual([3, 12]);
    expect(extractNumbers('feature/tpm-7-login-bug', 'TPM')).toEqual([7]);
    expect(extractNumbers('[TPM-1][TPM-2](TPM-3)', 'TPM')).toEqual([1, 2, 3]);
    expect(extractNumbers('closes TPM-42.', 'TPM')).toEqual([42]);
  });

  it('다른 프로젝트 키·글자에 붙은 키·0·너무 긴 번호는 제외한다', () => {
    expect(extractNumbers('OTHER-5 and XTPM-6 and TPM-7abc and TPM-0', 'TPM')).toEqual([]);
    expect(extractNumbers('TPM-1234567', 'TPM')).toEqual([]);
    expect(extractNumbers('ATPM-1', 'TPM')).toEqual([]);
    expect(extractNumbers('UTF-8 CVE-2024-1234', 'TPM')).toEqual([]);
  });

  it('값이 없어도 안전하고, 키에 정규식 특수문자가 있어도 안전하다', () => {
    expect(extractNumbers(null, 'TPM')).toEqual([]);
    expect(extractNumbers('TPM-1', '')).toEqual([]);
    expect(extractNumbers('A.B-1', 'A.B')).toEqual([]); // 특수문자는 제거되어 AB 로 찾는다
    expect(extractNumbers('AB-1', 'A.B')).toEqual([1]);
  });

  it('extractNumbersFrom 은 여러 텍스트의 결과를 합친다', () => {
    expect(extractNumbersFrom(['TPM-2', undefined, 'branch tpm-1', 'TPM-2'], 'TPM')).toEqual([
      1, 2,
    ]);
  });
});

describe('prState', () => {
  it('머지 > 닫힘 > draft > 열림 순으로 정한다', () => {
    expect(prState({ merged: true, state: 'closed' })).toBe('merged');
    expect(prState({ merged_at: '2026-10-21T00:00:00Z', state: 'closed' })).toBe('merged');
    expect(prState({ state: 'closed', merged: false })).toBe('closed');
    expect(prState({ state: 'open', draft: true })).toBe('draft');
    expect(prState({ state: 'open' })).toBe('open');
    expect(prState(undefined)).toBe('open');
  });
});

describe('웹훅 서명', () => {
  const conn = { id: '3f1c2d0e-0000-4000-8000-000000000001', secret_version: 1 };
  const secret = webhookSecret(conn, 'server-secret-for-tests-0123456789');

  it('비밀은 연결·버전·서버 비밀마다 다르고 같은 입력이면 같다', () => {
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(webhookSecret(conn, 'server-secret-for-tests-0123456789')).toBe(secret);
    expect(
      webhookSecret({ ...conn, secret_version: 2 }, 'server-secret-for-tests-0123456789'),
    ).not.toBe(secret);
    expect(webhookSecret({ ...conn, id: 'x' }, 'server-secret-for-tests-0123456789')).not.toBe(
      secret,
    );
    expect(webhookSecret(conn, 'another-server-secret-0123456789012')).not.toBe(secret);
  });

  it('올바른 서명만 통과하고 본문이 바뀌거나 형식이 틀리면 거부한다', () => {
    const body = Buffer.from('{"zen":"Keep it logically awesome."}');
    const header = signBody(secret, body);
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature(secret, body, header)).toBe(true);
    expect(verifySignature(secret, Buffer.from('{"zen":"changed"}'), header)).toBe(false);
    expect(verifySignature('other-secret', body, header)).toBe(false);
    for (const bad of [
      undefined,
      '',
      'sha256=',
      'sha256=zz',
      header.replace('sha256=', 'sha1='),
      header.slice(0, -2),
      `${header}00`,
    ]) {
      expect(verifySignature(secret, body, bad), String(bad)).toBe(false);
    }
  });
});

describe('extractClosedIssues', () => {
  const find = (text, repo = 'octo/hello') => extractClosedIssues([text], repo);

  it('GitHub 키워드(close/fix/resolve 의 활용형, 대소문자 무시)와 #N 을 찾는다', () => {
    expect(find('Closes #1, fixed #2 Resolves: #3 and FIX #4')).toEqual([1, 2, 3, 4]);
    expect(find('fixes #6\r\ncloses #7')).toEqual([6, 7]);
    expect(find('close #5 fixes #5')).toEqual([5]);
  });

  it('키워드가 없거나 붙어 있는 글자가 있으면 무시한다', () => {
    expect(find('see #1, related #2')).toEqual([]);
    expect(find('prefixes #1 and disclose #2 and closes#3')).toEqual([]);
    expect(find('closes #12abc')).toEqual([]);
  });

  it('같은 저장소 이름은 인정하고 다른 저장소는 무시한다(대소문자 무시)', () => {
    expect(find('fixes octo/hello#7, fixes other/repo#8, fixes OCTO/Hello#9')).toEqual([7, 9]);
  });

  it('여러 텍스트를 합치고 빈 값은 건너뛴다', () => {
    expect(extractClosedIssues(['fixes #2', null, undefined, 'closes #1'], 'a/b')).toEqual([1, 2]);
  });
});
