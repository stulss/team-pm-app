import { describe, it, expect, afterEach } from 'vitest';
import { formatWhen } from '../../../client/src/constants/activity.js';
import { hourCycle, setTimeFormat } from '../../../client/src/utils/displayFormat.js';

afterEach(() => setTimeFormat('12h'));

describe('시각 표기 설정', () => {
  it('기본은 12시간(오전/오후), 24시간으로 바꾸면 오전/오후가 사라진다', () => {
    const iso = '2026-10-21T15:05:00';
    expect(hourCycle()).toEqual({ hour12: true });
    expect(formatWhen(iso)).toMatch(/오후/);
    setTimeFormat('24h');
    expect(hourCycle()).toEqual({ hour12: false });
    const text = formatWhen(iso);
    expect(text).not.toMatch(/오[전후]/);
    expect(text).toContain('15:05');
  });

  it('알 수 없는 값은 12시간으로 본다', () => {
    setTimeFormat('24h');
    setTimeFormat(undefined);
    expect(hourCycle()).toEqual({ hour12: true });
  });
});
