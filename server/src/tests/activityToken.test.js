import { describe, it, expect } from 'vitest';
import { describeActivity } from '../../../client/src/constants/activity.js';

describe('describeActivity: API 토큰 표시', () => {
  const base = {
    action: 'task.created',
    meta: { title: '결제 연동' },
  };

  it('토큰으로 한 일은 토큰 이름을 덧붙인다', () => {
    expect(describeActivity({ ...base, meta: { ...base.meta, token: 'Claude' } })).toBe(
      '작업 “결제 연동”을(를) 만들었습니다. (API 토큰: Claude)',
    );
  });

  it('사람이 한 일에는 붙지 않는다', () => {
    expect(describeActivity(base)).toBe('작업 “결제 연동”을(를) 만들었습니다.');
    expect(describeActivity(base, { showTask: false })).toBe('작업을(를) 만들었습니다.');
  });
});
