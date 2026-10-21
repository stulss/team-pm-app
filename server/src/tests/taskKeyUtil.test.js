import { describe, it, expect } from 'vitest';
// 클라이언트의 순수 함수를 서버 테스트 러너로 검증한다.
import { branchName, isTaskKey } from '../../../client/src/utils/taskKey.js';
import { TASK_KEY_PATTERN as SERVER_PATTERN } from '../modules/projects/key.js';

describe('isTaskKey', () => {
  it('서버와 같은 형식을 판단한다 (앞뒤 공백은 무시)', () => {
    for (const ok of ['TPM-12', 'tpm-1', ' AB-123456 ', 'A1-1']) {
      expect(isTaskKey(ok), ok).toBe(true);
      expect(SERVER_PATTERN.test(ok.trim())).toBe(true);
    }
    for (const bad of ['TPM12', 'T-1', 'TPM-', '12-34', 'TPM-1234567', '', null, undefined]) {
      expect(isTaskKey(bad), String(bad)).toBe(false);
    }
  });
});

describe('branchName', () => {
  it('키를 소문자로 쓰고 제목의 영문·숫자 단어를 최대 6개 이어 붙인다', () => {
    expect(branchName({ key: 'TPM-12', title: 'Fix login bug' })).toBe('tpm-12-fix-login-bug');
    expect(branchName({ key: 'TPM-3', title: 'a b c d e f g h' })).toBe('tpm-3-a-b-c-d-e-f');
    expect(branchName({ key: 'TPM-4', title: 'API v2 연동!! (결제)' })).toBe('tpm-4-api-v2');
  });

  it('영문이 없는 제목은 키만, 키가 없으면 빈 문자열, 길이는 60자까지', () => {
    expect(branchName({ key: 'TPM-5', title: '결제 화면 구현' })).toBe('tpm-5');
    expect(branchName({ title: 'x' })).toBe('');
    expect(branchName(null)).toBe('');
    expect(branchName({ key: 'TPM-6', title: 'x'.repeat(100) }).length).toBeLessThanOrEqual(60);
  });
});
