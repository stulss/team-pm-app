export const STATUS_LABELS = {
  todo: '할 일',
  in_progress: '진행 중',
  review: '검토',
  done: '완료',
};
export const PRIORITY_LABELS = { low: '낮음', medium: '보통', high: '높음', urgent: '긴급' };

export const STATUSES = Object.keys(STATUS_LABELS);
export const PRIORITIES = Object.keys(PRIORITY_LABELS);

// 마감일은 날짜 문자열(YYYY-MM-DD)이므로 같은 형식의 로컬 오늘 날짜와 문자열로 비교한다.
export const todayString = () => new Date().toLocaleDateString('sv-SE');

export const isOverdue = (task) =>
  Boolean(task.dueDate) && task.status !== 'done' && task.dueDate < todayString();

// 화면 표시용. 서버가 최종 검사를 한다. (Admin/Manager/프로젝트 소유자는 모두, 그 외는 본인이 만든 작업만)
export const canDeleteTask = (user, task, ownerId) =>
  user.role === 'admin' ||
  user.role === 'manager' ||
  ownerId === user.id ||
  task.createdBy === user.id;
