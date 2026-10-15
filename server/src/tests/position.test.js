import { describe, it, expect } from 'vitest';
import { MIN_GAP, POSITION_STEP, positionBetween } from '../utils/position.js';

describe('positionBetween', () => {
  it('둘 다 있으면 중간값', () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(0.5, 1.5)).toBe(1);
  });

  it('앞 이웃만 있으면 맨 아래 (before + STEP)', () => {
    expect(positionBetween(3072, undefined)).toBe(3072 + POSITION_STEP);
    expect(positionBetween(0, null)).toBe(POSITION_STEP);
  });

  it('뒤 이웃만 있으면 맨 위 (after / 2)', () => {
    expect(positionBetween(undefined, 1024)).toBe(512);
    expect(positionBetween(null, 2048)).toBe(1024);
  });

  it('이웃이 없으면 STEP', () => {
    expect(positionBetween(undefined, undefined)).toBe(POSITION_STEP);
    expect(positionBetween(null, null)).toBe(POSITION_STEP);
  });

  it('간격이 너무 좁으면 null (재정렬 필요)', () => {
    expect(positionBetween(1, 1 + MIN_GAP)).toBeNull();
    expect(positionBetween(1, 1 + MIN_GAP * 3)).not.toBeNull();
    expect(positionBetween(undefined, MIN_GAP)).toBeNull();
  });

  it('순서가 뒤집혔거나 같으면 null', () => {
    expect(positionBetween(2048, 1024)).toBeNull();
    expect(positionBetween(1024, 1024)).toBeNull();
  });

  it('맨 위 삽입을 반복하면 결국 null 이 되어 재정렬을 요구한다', () => {
    let top = POSITION_STEP;
    let steps = 0;
    for (; steps < 100; steps += 1) {
      const next = positionBetween(undefined, top);
      if (next === null) break;
      top = next;
    }
    expect(steps).toBeGreaterThan(10);
    expect(steps).toBeLessThan(100);
  });
});
