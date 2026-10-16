import { describe, it, expect } from 'vitest';
// 클라이언트의 순수 함수(DOM 을 건드리지 않는 부분)를 서버 테스트 러너로 검증한다.
import { buildCsv, csvCell } from '../../../client/src/utils/csv.js';

describe('csvCell', () => {
  it('쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 따옴표는 두 번 쓴다', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('말 "인용" 포함')).toBe('"말 ""인용"" 포함"');
    expect(csvCell('두 줄\n입니다')).toBe('"두 줄\n입니다"');
    expect(csvCell('평범한 값')).toBe('평범한 값');
  });

  it('null·undefined 는 빈 칸, 숫자는 문자로', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(12)).toBe('12');
  });

  it('수식으로 해석될 수 있는 값은 앞에 작은따옴표를 붙여 무력화한다', () => {
    for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '\r=1']) {
      expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });

  it('값 중간의 = 나 - 는 건드리지 않는다', () => {
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('2026-10-16')).toBe('2026-10-16');
  });
});

describe('buildCsv', () => {
  it('UTF-8 BOM 으로 시작하고 CRLF 로 행을 구분하며 마지막에 줄바꿈이 있다', () => {
    const csv = buildCsv([
      ['일시', '내용'],
      ['2026-10-16 09:00:00', '작업 "A", 수정'],
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('일시,내용\r\n2026-10-16 09:00:00,"작업 ""A"", 수정"\r\n');
  });

  it('작업 제목에 들어간 수식도 CSV 에서는 문자로 남는다', () => {
    const csv = buildCsv([['x'], ['=cmd|calc']]);
    expect(csv).toContain("\r\n'=cmd|calc\r\n");
  });
});
