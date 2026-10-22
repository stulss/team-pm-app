// 시각 표기(12시간/24시간). 설정이 바뀌면 applyPreferences 가 여기에 알려 주고, 날짜를 그리는 곳이 읽어 쓴다.
let hour12 = true;

export const setTimeFormat = (format) => {
  hour12 = format !== '24h';
};

// toLocaleString 옵션에 펼쳐 쓴다: new Date(x).toLocaleString('ko-KR', { ..., ...hourCycle() })
export const hourCycle = () => ({ hour12 });
