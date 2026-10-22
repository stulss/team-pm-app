import { describe, it, expect } from 'vitest';
import { describeDevice } from '../../../client/src/constants/device.js';

describe('describeDevice', () => {
  it('브라우저와 OS 를 읽기 쉬운 이름으로 줄인다', () => {
    const cases = [
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
        'Chrome · Windows',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0',
        'Edge · Windows',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
        'Safari · macOS',
      ],
      ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox · Linux'],
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',
        'Safari · iPhone',
      ],
      [
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
        'Chrome · Android',
      ],
    ];
    for (const [ua, expected] of cases) expect(describeDevice(ua)).toBe(expected);
  });

  it('값이 없거나 알 수 없으면 기본 이름', () => {
    expect(describeDevice(null)).toBe('알 수 없는 기기');
    expect(describeDevice('')).toBe('알 수 없는 기기');
    expect(describeDevice('curl/8.0')).toBe('브라우저');
  });
});
