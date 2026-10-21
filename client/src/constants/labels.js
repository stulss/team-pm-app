// 서버의 라벨 색 팔레트와 같은 키. 실제 색은 styles/index.css 의 .lc-<키> 가 정한다.
export const LABEL_COLORS = {
  red: '빨강',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  purple: '보라',
  pink: '분홍',
  gray: '회색',
};

export const COLOR_KEYS = Object.keys(LABEL_COLORS);

// 체크리스트 진행률 표시용 ("1/3"). 항목이 없으면 null.
export const checklistText = (checklist) =>
  checklist && checklist.total > 0 ? `${checklist.done}/${checklist.total}` : null;
