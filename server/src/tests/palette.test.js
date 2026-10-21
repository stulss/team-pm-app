import { describe, it, expect } from 'vitest';
// 클라이언트의 순수 함수를 서버 테스트 러너로 검증한다.
import {
  groupItems,
  matchScore,
  moveIndex,
  projectIdFromPath,
  rankItems,
} from '../../../client/src/utils/palette.js';

describe('matchScore', () => {
  it('처음 일치 3, 단어 처음 일치 2, 포함 1, 불일치 null, 빈 검색어 0', () => {
    expect(matchScore('프로젝트 목록', '프로')).toBe(3);
    expect(matchScore('프로젝트 목록', '목록')).toBe(2);
    expect(matchScore('프로젝트 목록', '젝트')).toBe(1);
    expect(matchScore('프로젝트 목록', '대시')).toBeNull();
    expect(matchScore('프로젝트 목록', '')).toBe(0);
    expect(matchScore('프로젝트 목록', '   ')).toBe(0);
  });

  it('대소문자를 구분하지 않고, 없는 값에도 안전하다', () => {
    expect(matchScore('Dashboard', 'dash')).toBe(3);
    expect(matchScore('Open Calendar', 'CAL')).toBe(2);
    expect(matchScore(undefined, 'a')).toBeNull();
    expect(matchScore(null, '')).toBe(0);
  });
});

describe('rankItems', () => {
  const items = [
    { label: '내 작업', keywords: ['tasks', 'mine'] },
    { label: '모아보기', keywords: ['feed'] },
    { label: '작업 만들기', keywords: ['new', 'task'] },
    { label: '대시보드', keywords: ['dashboard'] },
  ];

  it('검색어가 없으면 원래 순서 그대로', () => {
    expect(rankItems(items, '').map((i) => i.label)).toEqual([
      '내 작업',
      '모아보기',
      '작업 만들기',
      '대시보드',
    ]);
  });

  it('좋은 점수 순으로 정렬하고 같은 점수는 원래 순서를 지킨다', () => {
    // '작업': "작업 만들기"는 처음 일치(3), "내 작업"은 단어 처음 일치(2)
    expect(rankItems(items, '작업').map((i) => i.label)).toEqual(['작업 만들기', '내 작업']);
  });

  it('키워드로도 찾고, 맞지 않는 항목은 걸러낸다', () => {
    expect(rankItems(items, 'feed').map((i) => i.label)).toEqual(['모아보기']);
    expect(rankItems(items, 'dash').map((i) => i.label)).toEqual(['대시보드']);
    expect(rankItems(items, 'zzz')).toEqual([]);
  });
});

describe('moveIndex', () => {
  it('끝에서 반대쪽으로 이어지고, 항목이 없으면 0', () => {
    expect(moveIndex(0, 1, 3)).toBe(1);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(1, -1, 3)).toBe(0);
    expect(moveIndex(5, 1, 0)).toBe(0);
  });
});

describe('groupItems', () => {
  it('처음 나온 순서로 그룹을 만들고 평면 위치를 붙인다', () => {
    const items = [
      { group: '이동', label: 'a' },
      { group: '프로젝트', label: 'b' },
      { group: '이동', label: 'c' },
    ];
    const groups = groupItems(items);
    expect(groups.map((g) => g.group)).toEqual(['이동', '프로젝트']);
    expect(groups[0].items.map((x) => [x.item.label, x.index])).toEqual([
      ['a', 0],
      ['c', 2],
    ]);
    expect(groups[1].items.map((x) => x.index)).toEqual([1]);
    expect(groupItems([])).toEqual([]);
  });
});

describe('projectIdFromPath', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  it('프로젝트 화면 경로에서만 id 를 돌려준다', () => {
    expect(projectIdFromPath(`/projects/${id}`)).toBe(id);
    expect(projectIdFromPath(`/projects/${id}/`)).toBe(id);
    expect(projectIdFromPath('/projects/not-a-uuid')).toBeNull();
    expect(projectIdFromPath('/')).toBeNull();
    expect(projectIdFromPath('/search')).toBeNull();
    expect(projectIdFromPath(`/other/projects/${id}`)).toBeNull();
  });
});
