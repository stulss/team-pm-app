import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from '../constants/task.js';
import { unescapeCell } from './csv.js';

export const MAX_IMPORT_ROWS = 200;

export const HEADERS = [
  '제목',
  '설명',
  '상태',
  '우선순위',
  '담당자',
  '시작일',
  '마감일',
  '라벨',
  '키',
];
// 머리글 별칭(영문·키 이름도 받는다). 라벨·키 열은 내보내기 전용이라 가져올 때 무시한다.
const ALIASES = {
  title: ['제목', 'title'],
  description: ['설명', 'description'],
  status: ['상태', 'status'],
  priority: ['우선순위', 'priority'],
  assignee: ['담당자', '담당자 이메일', 'assignee', 'assignee email'],
  startDate: ['시작일', 'start', 'startdate', 'start date'],
  dueDate: ['마감일', 'due', 'duedate', 'due date'],
};

// 내보내기: 작업 목록 → CSV 행(머리글 포함). 담당자는 멤버 이메일로 쓴다.
export function taskRows(tasks, members) {
  const emailOf = new Map(members.map((m) => [m.id, m.email]));
  return [
    HEADERS,
    ...tasks.map((t) => [
      t.title,
      t.description ?? '',
      STATUS_LABELS[t.status] ?? t.status,
      PRIORITY_LABELS[t.priority] ?? t.priority,
      t.assignee ? (emailOf.get(t.assignee.id) ?? t.assignee.name) : '',
      t.startDate ?? '',
      t.dueDate ?? '',
      (t.labels ?? []).map((l) => l.name).join(' | '),
      t.key ?? '',
    ]),
  ];
}

const normalize = (text) => text.trim().toLowerCase();
const byName = (labels, keys) =>
  new Map([...keys.map((k) => [k, k]), ...keys.map((k) => [normalize(labels[k]), k])]);
const STATUS_LOOKUP = byName(STATUS_LABELS, STATUSES);
const PRIORITY_LOOKUP = byName(PRIORITY_LABELS, PRIORITIES);

function parseDate(text) {
  const value = text.trim().replace(/[./]/g, '-');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 가져오기: parseCsv 결과 → { tasks, errors }. 오류가 하나라도 있으면 화면이 가져오기를 막는다(전부 아니면 전무).
// errors 의 line 은 파일의 줄 번호(머리글이 1)다. tasks 는 서버 import API 의 rows 모양이다.
export function readTasks(rows, members) {
  const errors = [];
  if (rows.length === 0)
    return { tasks: [], errors: [{ line: 0, message: '내용이 없는 파일입니다.' }] };
  const header = rows[0].map(normalize);
  const col = Object.fromEntries(
    Object.entries(ALIASES).map(([field, names]) => [
      field,
      header.findIndex((h) => names.includes(h)),
    ]),
  );
  if (col.title < 0) {
    return {
      tasks: [],
      errors: [{ line: 1, message: '"제목" 열이 없습니다. 첫 줄은 머리글이어야 합니다.' }],
    };
  }
  const body = rows.slice(1);
  if (body.length === 0)
    return { tasks: [], errors: [{ line: 0, message: '가져올 작업이 없습니다.' }] };
  if (body.length > MAX_IMPORT_ROWS) {
    return {
      tasks: [],
      errors: [
        {
          line: 0,
          message: `한 번에 최대 ${MAX_IMPORT_ROWS}개까지 가져올 수 있습니다(${body.length}개).`,
        },
      ],
    };
  }

  const memberByEmail = new Map(
    members.filter((m) => m.isActive).map((m) => [normalize(m.email), m.id]),
  );
  const tasks = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const get = (field) => (col[field] >= 0 ? unescapeCell(cells[col[field]] ?? '').trim() : '');
    const fail = (message) => errors.push({ line, message });
    const task = {};

    const title = get('title');
    if (!title) fail('제목이 비어 있습니다.');
    else if (title.length > 200) fail('제목은 200자까지 쓸 수 있습니다.');
    task.title = title;

    const description = col.description >= 0 ? unescapeCell(cells[col.description] ?? '') : '';
    if (description.length > 10_000) fail('설명은 10000자까지 쓸 수 있습니다.');
    if (description.trim()) task.description = description;

    for (const [field, lookup, fallback, label] of [
      ['status', STATUS_LOOKUP, 'todo', '상태'],
      ['priority', PRIORITY_LOOKUP, 'medium', '우선순위'],
    ]) {
      const raw = get(field);
      if (!raw) task[field] = fallback;
      else if (lookup.has(normalize(raw))) task[field] = lookup.get(normalize(raw));
      else fail(`알 수 없는 ${label}입니다: ${raw}`);
    }

    const email = get('assignee');
    if (email) {
      const id = memberByEmail.get(normalize(email));
      if (id) task.assigneeId = id;
      else fail(`담당자를 찾을 수 없습니다(프로젝트의 활성 멤버 이메일이어야 함): ${email}`);
    }

    for (const [field, label] of [
      ['startDate', '시작일'],
      ['dueDate', '마감일'],
    ]) {
      const raw = get(field);
      if (!raw) continue;
      const date = parseDate(raw);
      if (date) task[field] = date;
      else fail(`${label} 형식이 올바르지 않습니다(YYYY-MM-DD): ${raw}`);
    }
    if (task.startDate && task.dueDate && task.startDate > task.dueDate) {
      fail('시작일은 마감일보다 늦을 수 없습니다.');
    }
    tasks.push(task);
  });
  return { tasks, errors };
}
