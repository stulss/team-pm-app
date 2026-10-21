import { describe, it, expect } from 'vitest';
// 클라이언트의 순수 함수를 서버 테스트 러너로 검증한다.
import { dateKey, groupByDueDate, monthCells } from '../../../client/src/utils/calendar.js';
import { applySaved, currentFilters } from '../../../client/src/utils/savedFilters.js';

describe('monthCells', () => {
  it('앞쪽 빈 칸은 그 달 1일의 요일(일요일=0)만큼, 날짜는 말일까지', () => {
    // 2026-10-01 은 목요일(4)
    const oct = monthCells(2026, 9);
    expect(oct.slice(0, 4)).toEqual([null, null, null, null]);
    expect(oct[4]).toBe(1);
    expect(oct.filter(Boolean)).toHaveLength(31);
    expect(oct.at(-1)).toBe(31);
  });

  it('일요일에 시작하는 달은 빈 칸이 없고, 윤년 2월은 29일', () => {
    // 2026-02-01 은 일요일, 2028 은 윤년
    expect(monthCells(2026, 1)[0]).toBe(1);
    expect(monthCells(2026, 1).filter(Boolean)).toHaveLength(28);
    expect(monthCells(2028, 1).filter(Boolean)).toHaveLength(29);
  });
});

describe('dateKey / groupByDueDate', () => {
  it('month 는 0부터이고 한 자리 수는 0 으로 채운다', () => {
    expect(dateKey(2026, 0, 5)).toBe('2026-01-05');
    expect(dateKey(2026, 11, 31)).toBe('2026-12-31');
  });

  it('마감일별로 묶고 마감일 없는 작업은 따로 돌려준다', () => {
    const tasks = [
      { id: 'a', dueDate: '2026-10-05' },
      { id: 'b', dueDate: '2026-10-05' },
      { id: 'c', dueDate: null },
      { id: 'd', dueDate: '2026-10-06' },
    ];
    const { byDay, undated } = groupByDueDate(tasks);
    expect(byDay.get('2026-10-05').map((t) => t.id)).toEqual(['a', 'b']);
    expect(byDay.get('2026-10-06')).toHaveLength(1);
    expect(undated.map((t) => t.id)).toEqual(['c']);
  });
});

describe('currentFilters / applySaved', () => {
  const ctx = { labelIds: new Set(['L1']), memberIds: new Set(['U1']) };

  it('값이 있는 조건만 저장 형식으로 만들고 검색어는 다듬는다', () => {
    expect(currentFilters({ status: '', priority: 'high', assignee: '', label: '' }, '  ')).toEqual(
      {
        priority: 'high',
      },
    );
    expect(
      currentFilters({ status: 'todo', priority: '', assignee: 'me', label: 'L1' }, ' 시안 '),
    ).toEqual({ status: 'todo', assignee: 'me', label: 'L1', q: '시안' });
    expect(currentFilters({}, '')).toEqual({});
  });

  it('저장된 필터를 화면 상태로 복원한다', () => {
    const saved = { filters: { status: 'done', assignee: 'U1', label: 'L1', q: '배포' } };
    expect(applySaved(saved, ctx)).toEqual({
      filters: { status: 'done', priority: '', assignee: 'U1', label: 'L1' },
      q: '배포',
    });
  });

  it('지워진 라벨·멤버 값은 버리고, me/unassigned 는 유지한다', () => {
    const gone = applySaved({ filters: { assignee: 'U9', label: 'L9' } }, ctx);
    expect(gone.filters).toMatchObject({ assignee: '', label: '' });
    expect(applySaved({ filters: { assignee: 'me' } }, ctx).filters.assignee).toBe('me');
    expect(applySaved({ filters: { assignee: 'unassigned' } }, ctx).filters.assignee).toBe(
      'unassigned',
    );
    expect(applySaved({}, ctx)).toEqual({
      filters: { status: '', priority: '', assignee: '', label: '' },
      q: '',
    });
  });
});
