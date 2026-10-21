// 작업 키(TPM-12) 관련 순수 함수. 서버의 server/src/modules/projects/key.js 와 같은 형식이다.
export const TASK_KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,6})$/;

export const isTaskKey = (text) => TASK_KEY_PATTERN.test(String(text ?? '').trim());

// 브랜치 이름: 키를 소문자로 쓰고 제목의 영문·숫자 단어를 이어 붙인다. 예) tpm-12-fix-login-bug
// GitHub 연동은 브랜치·PR 제목·커밋 메시지에서 이 키를 찾아 작업에 연결한다.
export function branchName(task) {
  if (!task?.key) return '';
  const slug = String(task.title ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  const words = (slug ?? []).slice(0, 6).join('-');
  return (words ? `${task.key.toLowerCase()}-${words}` : task.key.toLowerCase()).slice(0, 60);
}
