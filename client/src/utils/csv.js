const BOM = String.fromCharCode(0xfeff); // UTF-8 BOM(엑셀이 한글을 올바르게 읽게 함)

// 엑셀에서 열었을 때 수식으로 실행될 수 있는 값(=, +, -, @, 탭, 줄바꿈으로 시작)은 앞에 ' 를 붙여 문자로 만든다.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// rows: 값 배열의 배열. 첫 행은 머리글. 한글이 깨지지 않도록 UTF-8 BOM 을 앞에 붙인다.
export function buildCsv(rows) {
  return `${BOM}${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// csvCell 이 수식 방지로 붙인 작은따옴표를 되돌린다('=1+1 → =1+1).
export const unescapeCell = (text) => (/^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text);

// CSV 본문을 값 배열의 배열로 읽는다. 따옴표("" 이스케이프·줄바꿈 포함)·CRLF·BOM 을 처리하고 완전히 빈 줄은 건너뛴다.
export function parseCsv(text) {
  const input = text.startsWith(BOM) ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') endCell();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

export function downloadCsv(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
