import { describe, it, expect } from 'vitest';
// 클라이언트의 순수 함수를 서버 테스트 러너로 검증한다.
import {
  addDays,
  barSpan,
  diffDays,
  openBlockers,
  scheduleConflicts,
  taskRange,
  weekStart,
  windowKeys,
} from '../../../client/src/utils/timeline.js';

describe('날짜 계산', () => {
  it('addDays / diffDays 는 월·연·윤년 경계와 서머타임에도 하루씩 정확하다', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2); // 미국 서머타임 시작 주간
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2);
    expect(diffDays('2026-10-10', '2026-10-05')).toBe(-5);
  });

  it('weekStart 는 월요일을 돌려준다', () => {
    expect(weekStart('2026-10-21')).toBe('2026-10-19'); // 수 → 월
    expect(weekStart('2026-10-19')).toBe('2026-10-19'); // 월 그대로
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // 일 → 그 주 월
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
  });

  it('windowKeys 는 연속된 날짜를 days 개 만든다', () => {
    const keys = windowKeys('2026-10-26', 7);
    expect(keys).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(windowKeys('2026-10-26')).toHaveLength(28);
  });
});

describe('taskRange / barSpan', () => {
  const start = '2026-10-19';

  it('시작일·마감일 중 하나만 있으면 하루짜리, 둘 다 없으면 null', () => {
    expect(taskRange({ startDate: '2026-10-20', dueDate: '2026-10-23' })).toEqual({
      start: '2026-10-20',
      end: '2026-10-23',
    });
    expect(taskRange({ dueDate: '2026-10-23' })).toEqual({
      start: '2026-10-23',
      end: '2026-10-23',
    });
    expect(taskRange({ startDate: '2026-10-20' })).toEqual({
      start: '2026-10-20',
      end: '2026-10-20',
    });
    expect(taskRange({})).toBeNull();
    expect(barSpan({}, start)).toBeNull();
  });

  it('창 안의 막대는 열 위치를 그대로 돌려준다', () => {
    expect(barSpan({ startDate: '2026-10-20', dueDate: '2026-10-23' }, start)).toEqual({
      start: 1,
      end: 4,
      clippedLeft: false,
      clippedRight: false,
    });
  });

  it('창 경계에 걸치면 잘라서 표시하고 잘렸음을 알린다', () => {
    const left = barSpan({ startDate: '2026-10-10', dueDate: '2026-10-21' }, start);
    expect(left).toEqual({ start: 0, end: 2, clippedLeft: true, clippedRight: false });
    const right = barSpan({ startDate: '2026-11-10', dueDate: '2026-11-20' }, start, 28);
    expect(right).toEqual({ start: 22, end: 27, clippedLeft: false, clippedRight: true });
    const both = barSpan({ startDate: '2026-10-01', dueDate: '2026-12-01' }, start);
    expect(both).toEqual({ start: 0, end: 27, clippedLeft: true, clippedRight: true });
  });

  it('창 밖(앞·뒤)이면 null, 첫날과 마지막 날은 포함', () => {
    expect(barSpan({ dueDate: '2026-10-18' }, start)).toBeNull();
    expect(barSpan({ dueDate: '2026-11-16' }, start)).toBeNull(); // 창은 10/19~11/15
    expect(barSpan({ dueDate: '2026-10-19' }, start)).toMatchObject({ start: 0, end: 0 });
    expect(barSpan({ dueDate: '2026-11-15' }, start)).toMatchObject({ start: 27, end: 27 });
  });
});

describe('선행 작업', () => {
  const blocker = (over) => ({ id: 'b', title: 'B', status: 'todo', dueDate: null, ...over });

  it('openBlockers 는 완료되지 않은 선행 작업만 센다', () => {
    const task = {
      blockedBy: [blocker({ status: 'done' }), blocker({ id: 'c', status: 'review' })],
    };
    expect(openBlockers(task).map((b) => b.id)).toEqual(['c']);
    expect(openBlockers({})).toEqual([]);
  });

  it('선행 작업의 마감이 시작보다 늦으면 일정 충돌, 같은 날은 충돌 아님', () => {
    const task = { startDate: '2026-10-20', dueDate: '2026-10-25' };
    const late = blocker({ id: 'late', dueDate: '2026-10-22' });
    const same = blocker({ id: 'same', dueDate: '2026-10-20' });
    const early = blocker({ id: 'early', dueDate: '2026-10-19' });
    expect(scheduleConflicts({ ...task, blockedBy: [late, same, early] }).map((b) => b.id)).toEqual(
      ['late'],
    );
  });

  it('완료된 선행 작업·마감일 없는 선행 작업·날짜 없는 작업은 충돌이 아니다', () => {
    const task = { startDate: '2026-10-20', dueDate: '2026-10-25' };
    expect(
      scheduleConflicts({
        ...task,
        blockedBy: [blocker({ status: 'done', dueDate: '2026-12-01' })],
      }),
    ).toEqual([]);
    expect(scheduleConflicts({ ...task, blockedBy: [blocker()] })).toEqual([]);
    expect(scheduleConflicts({ blockedBy: [blocker({ dueDate: '2026-12-01' })] })).toEqual([]);
    // 시작일이 없으면 마감일을 시작으로 본다
    expect(
      scheduleConflicts({ dueDate: '2026-10-25', blockedBy: [blocker({ dueDate: '2026-10-26' })] }),
    ).toHaveLength(1);
  });
});
