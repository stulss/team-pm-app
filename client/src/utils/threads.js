// 서버가 주는 작성순 평면 댓글 배열을 스레드([{ comment, replies }])로 묶는다.
// - 최상위 댓글은 작성순을 유지하고, 답글은 각 원 댓글 아래에 작성순으로 모인다.
// - 원 댓글을 찾을 수 없는 답글(비정상 데이터)은 사라지지 않게 최상위로 올린다.
export function buildThreads(comments) {
  const ids = new Set(comments.map((c) => c.id));
  const repliesOf = new Map();
  const roots = [];
  for (const c of comments) {
    if (c.parentId && ids.has(c.parentId)) {
      if (!repliesOf.has(c.parentId)) repliesOf.set(c.parentId, []);
      repliesOf.get(c.parentId).push(c);
    } else {
      roots.push(c);
    }
  }
  return roots.map((comment) => ({ comment, replies: repliesOf.get(comment.id) ?? [] }));
}
