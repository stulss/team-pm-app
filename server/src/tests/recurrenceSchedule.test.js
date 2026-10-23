import { describe, it, expect } from 'vitest';
import { addDays, firstOnOrAfter, nextAfter } from '../modules/recurrences/schedule.js';

describe('반복 규칙 날짜 계산', () => {
  it('addDays 는 달·해 경계를 넘는다', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('daily 는 from 그대로, nextAfter 는 내일', () => {
    const rule = { frequency: 'daily' };
    expect(firstOnOrAfter(rule, '2026-10-23')).toBe('2026-10-23');
    expect(nextAfter(rule, '2026-10-23')).toBe('2026-10-24');
  });

  it('weekly 는 같은 요일이면 당일 포함, 아니면 다음 해당 요일', () => {
    // 2026-10-23 은 금요일(5)
    expect(firstOnOrAfter({ frequency: 'weekly', weekday: 5 }, '2026-10-23')).toBe('2026-10-23');
    expect(firstOnOrAfter({ frequency: 'weekly', weekday: 1 }, '2026-10-23')).toBe('2026-10-26');
    expect(firstOnOrAfter({ frequency: 'weekly', weekday: 0 }, '2026-10-23')).toBe('2026-10-25');
  });

  it('weekly nextAfter 는 오늘이 해당 요일이어도 다음 주로 간다', () => {
    expect(nextAfter({ frequency: 'weekly', weekday: 5 }, '2026-10-23')).toBe('2026-10-30');
  });

  it('monthly 는 이번 달 날짜가 지났으면 다음 달로 간다', () => {
    const rule = { frequency: 'monthly', monthDay: 15 };
    expect(firstOnOrAfter(rule, '2026-10-10')).toBe('2026-10-15');
    expect(firstOnOrAfter(rule, '2026-10-15')).toBe('2026-10-15');
    expect(firstOnOrAfter(rule, '2026-10-16')).toBe('2026-11-15');
    expect(firstOnOrAfter(rule, '2026-12-20')).toBe('2027-01-15');
  });

  it('monthly 31일은 짧은 달에서 말일로 당겨진다', () => {
    const rule = { frequency: 'monthly', monthDay: 31 };
    expect(firstOnOrAfter(rule, '2026-02-01')).toBe('2026-02-28');
    expect(firstOnOrAfter(rule, '2028-02-01')).toBe('2028-02-29');
    expect(nextAfter(rule, '2026-01-31')).toBe('2026-02-28');
    expect(nextAfter(rule, '2026-02-28')).toBe('2026-03-31');
    expect(nextAfter(rule, '2026-04-30')).toBe('2026-05-31');
  });
});
