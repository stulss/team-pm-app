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
