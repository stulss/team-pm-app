// 프로젝트 키: 작업 키(TPM-12)의 앞부분. 대문자 영문으로 시작하는 2~10자의 영문 대문자·숫자.
export const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
// 작업 키 전체(대소문자 무시)
export const TASK_KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,6})$/;

// 이름에서 키 후보를 만든다: 영문 단어가 둘 이상이면 머리글자(최대 5자), 하나면 앞 4자.
// 영문이 거의 없는 이름(한글 등)은 'P'. 항상 KEY_PATTERN 을 만족한다.
export function suggestKey(name) {
  const words = String(name ?? '')
    .normalize('NFKD')
    .match(/[A-Za-z][A-Za-z0-9]*/g);
  let key;
  if (!words) key = 'P';
  else if (words.length >= 2)
    key = words
      .map((w) => w[0])
      .join('')
      .slice(0, 5);
  else key = words[0].slice(0, 4);
  key = key.toUpperCase();
  return key.length >= 2 ? key : `${key}P`;
}

// 겹치지 않는 키: 후보 → 후보2 → 후보3 …(10자를 넘지 않게 자른다). taken(key) 은 이미 쓰이는지 묻는 함수.
export async function uniqueKey(name, taken) {
  const base = suggestKey(name);
  if (!(await taken(base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, 10 - String(n).length)}${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error('프로젝트 키를 만들 수 없습니다.');
}
