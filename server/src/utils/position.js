// 칸반 순서(position) 계산. 이동할 때 한 행만 UPDATE 하도록 "사이에 끼우는" 방식이다.

export const POSITION_STEP = 1024;
// 이웃과의 간격이 이보다 작아지면 정밀도 고갈로 보고 컬럼 전체를 재정렬한다.
export const MIN_GAP = 1e-3;

/**
 * 앞(before, 위)·뒤(after, 아래) 이웃의 position 사이에 들어갈 값을 계산한다.
 * - 둘 다 있음: 중간값
 * - before 만: before + STEP (맨 아래)
 * - after 만: after / 2 (맨 위)
 * - 정밀도 고갈 또는 순서가 뒤집힌 경우: null (호출자가 재정렬 후 다시 계산)
 */
export function positionBetween(before, after) {
  const hasBefore = typeof before === 'number';
  const hasAfter = typeof after === 'number';

  if (hasBefore && hasAfter) {
    if (before >= after) return null;
    const mid = (before + after) / 2;
    return mid - before < MIN_GAP || after - mid < MIN_GAP ? null : mid;
  }
  if (hasBefore) return before + POSITION_STEP;
  if (hasAfter) {
    const half = after / 2;
    return half < MIN_GAP ? null : half;
  }
  return POSITION_STEP;
}
