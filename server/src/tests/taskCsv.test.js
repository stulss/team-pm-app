import { describe, it, expect } from 'vitest';
// 클라이언트의 순수 함수(DOM 을 건드리지 않는 부분)를 서버 테스트 러너로 검증한다.
import { buildCsv, parseCsv } from '../../../client/src/utils/csv.js';
import { MAX_IMPORT_ROWS, readTasks, taskRows } from '../../../client/src/utils/taskCsv.js';

const members = [
  { id: 'u1', email: 'Alice@Example.com', name: '앨리스', isActive: true },
  { id: 'u2', email: 'bob@example.com', name: '밥', isActive: false },
];
const read = (text) => readTasks(parseCsv(text), members);

describe('parseCsv', () => {
  it('따옴표·쉼표·큰따옴표 이스케이프·셀 안의 줄바꿈을 읽는다', () => {
    expect(parseCsv('a,"b,c","말 ""인용""","두 줄\r\n입니다"\r\n')).toEqual([
      ['a', 'b,c', '말 "인용"', '두 줄\r\n입니다'],
    ]);
  });

  it('BOM·CRLF·마지막 줄바꿈 없음·빈 줄을 처리한다', () => {
    expect(parseCsv('\uFEFFx,y\r\n\r\n1,2')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,,c\n')).toEqual([['a', '', 'c']]);
    expect(parseCsv('')).toEqual([]);
  });

  it('buildCsv 로 만든 것을 그대로 되읽는다(수식 방지 접두어 제외)', () => {
    const rows = [
      ['제목', '설명'],
      ['쉼표, 포함', '줄1\n줄2 "따옴표"'],
    ];
    expect(parseCsv(buildCsv(rows))).toEqual(rows);
  });
});

describe('readTasks', () => {
  const header = '제목,설명,상태,우선순위,담당자,시작일,마감일,라벨,키\n';

  it('한글·키 이름과 빈 칸 기본값, 담당자 이메일(대소문자 무시), 날짜 형식을 변환한다', () => {
    const { tasks, errors } = read(
      `${header}로그인 만들기,설명,진행 중,높음,alice@example.com,2030/5/1,2030.05.09,기능,PP-1\n` +
        `두 번째,,,,,,,,\n세 번째,,review,URGENT,,,,,\n`,
    );
    expect(errors).toEqual([]);
    expect(tasks).toEqual([
      {
        title: '로그인 만들기',
        description: '설명',
        status: 'in_progress',
        priority: 'high',
        assigneeId: 'u1',
        startDate: '2030-05-01',
        dueDate: '2030-05-09',
      },
      { title: '두 번째', status: 'todo', priority: 'medium' },
      { title: '세 번째', status: 'review', priority: 'urgent' },
    ]);
  });

  it('내보낸 파일을 다시 가져올 수 있다(라벨·키 열은 무시, 수식 접두어 제거)', () => {
    const exported = taskRows(
      [
        {
          title: '=SUM(A1)',
          description: null,
          status: 'done',
          priority: 'low',
          assignee: { id: 'u1', name: '앨리스' },
          startDate: null,
          dueDate: '2030-01-02',
          labels: [{ name: '버그' }],
          key: 'PP-3',
        },
      ],
      members,
    );
    const { tasks, errors } = read(buildCsv(exported));
    expect(errors).toEqual([]);
    expect(tasks).toEqual([
      {
        title: '=SUM(A1)',
        status: 'done',
        priority: 'low',
        assigneeId: 'u1',
        dueDate: '2030-01-02',
      },
    ]);
  });

  it('문제 있는 행을 줄 번호와 함께 모두 알린다', () => {
    const { errors } = read(
      `${header},, ,,,,,,\n` +
        `제목,,없는상태,,,,,,\n` +
        `제목,,,,bob@example.com,,,,\n` +
        `제목,,,,nobody@example.com,,,,\n` +
        `제목,,,,,2030-02-30,,,\n` +
        `제목,,,,,2030-06-02,2030-06-01,,\n`,
    );
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(errors[0].message).toContain('제목');
    expect(errors[1].message).toContain('상태');
    expect(errors[2].message).toContain('담당자'); // 비활성 멤버
  });

  it('제목 열이 없거나 데이터가 없거나 너무 많으면 거절한다', () => {
    expect(read('이름,설명\na,b\n').errors[0].message).toContain('제목');
    expect(read('제목\n').errors).toHaveLength(1);
    expect(read('').errors).toHaveLength(1);
    const many = `제목\n${Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `t${i}`).join('\n')}\n`;
    expect(read(many).errors[0].message).toContain(String(MAX_IMPORT_ROWS));
  });

  it('영문 머리글과 열 순서가 달라도 읽는다', () => {
    const { tasks, errors } = read('priority,Title\nhigh,할 일\n');
    expect(errors).toEqual([]);
    expect(tasks).toEqual([{ title: '할 일', status: 'todo', priority: 'high' }]);
  });
});
