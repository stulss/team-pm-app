// 명령 팔레트의 순수 함수: 검색어 매칭·정렬, 키보드 이동, 그룹 묶기.

const norm = (s) => String(s ?? '').toLowerCase();

// 검색어와 얼마나 잘 맞는지(높을수록 좋음). 맞지 않으면 null, 검색어가 비어 있으면 0.
//  3: 글자 처음부터 일치 / 2: 단어(공백 뒤) 처음부터 일치 / 1: 어딘가에 포함
export function matchScore(text, query) {
  const q = norm(query).trim();
  if (!q) return 0;
  const t = norm(text);
  if (t.startsWith(q)) return 3;
  if (t.split(/\s+/).some((word) => word.startsWith(q))) return 2;
  return t.includes(q) ? 1 : null;
}

// items: [{ label, keywords?: string[] }]. 라벨과 키워드 중 가장 좋은 점수로 거르고 정렬한다
// (점수가 같으면 원래 순서). 검색어가 비면 모두 원래 순서대로 돌려준다.
export function rankItems(items, query) {
  return items
    .map((item, index) => {
      const scores = [item.label, ...(item.keywords ?? [])]
        .map((text) => matchScore(text, query))
        .filter((s) => s !== null);
      return { item, index, score: scores.length ? Math.max(...scores) : null };
    })
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}

// 위/아래 화살표 이동(양 끝에서 반대쪽으로 이어진다). 항목이 없으면 0.
export function moveIndex(current, delta, length) {
  if (length <= 0) return 0;
  return (((current + delta) % length) + length) % length;
}

// 평면 목록을 그룹별로 묶되, 각 항목에 평면 목록에서의 위치(index)를 붙인다. 그룹 순서는 처음 나온 순서.
export function groupItems(items) {
  const groups = [];
  const byName = new Map();
  items.forEach((item, index) => {
    if (!byName.has(item.group)) {
      const entry = { group: item.group, items: [] };
      byName.set(item.group, entry);
      groups.push(entry);
    }
    byName.get(item.group).items.push({ item, index });
  });
  return groups;
}

// 현재 경로가 프로젝트 화면(/projects/:id)이면 그 id, 아니면 null.
export function projectIdFromPath(pathname) {
  const m = /^\/projects\/([0-9a-fA-F-]{36})(?:\/|$)/.exec(pathname);
  return m ? m[1] : null;
}
