const pad = (n) => String(n).padStart(2, '0');

// month 는 0부터(Date 와 같음). 마감일 문자열(YYYY-MM-DD)과 비교하는 키를 만든다.
export const dateKey = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;

export const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

// 요일 머리글. 월요일 시작이면 일요일이 맨 끝으로 간다.
export const weekdayHeads = (weekStart = 'sun') =>
  weekStart === 'mon' ? [...WEEKDAY_NAMES.slice(1), WEEKDAY_NAMES[0]] : WEEKDAY_NAMES;

// 한 달치 칸(앞쪽 빈 칸 포함, 한 주의 시작은 설정에 따른다). 날짜가 없는 칸은 null.
export function monthCells(year, month, weekStart = 'sun') {
  const first = new Date(year, month, 1).getDay();
  const offset = weekStart === 'mon' ? (first + 6) % 7 : first;
  const days = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
}

// 작업을 마감일 키별로 묶고, 마감일이 없는 것은 따로 돌려준다.
export function groupByDueDate(tasks) {
  const byDay = new Map();
  const undated = [];
  for (const t of tasks) {
    if (!t.dueDate) undated.push(t);
    else byDay.set(t.dueDate, [...(byDay.get(t.dueDate) ?? []), t]);
  }
  return { byDay, undated };
}
