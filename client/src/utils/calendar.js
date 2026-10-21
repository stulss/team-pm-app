const pad = (n) => String(n).padStart(2, '0');

// month 는 0부터(Date 와 같음). 마감일 문자열(YYYY-MM-DD)과 비교하는 키를 만든다.
export const dateKey = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;

// 한 달치 칸(일요일 시작, 앞쪽 빈 칸 포함). 날짜가 없는 칸은 null.
export function monthCells(year, month) {
  const offset = new Date(year, month, 1).getDay();
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
