import { PRIORITY_LABELS, STATUS_LABELS } from './task.js';
import { PR_STATE_LABELS } from './github.js';
import { hourCycle } from '../utils/displayFormat.js';

const label = (map, key) => map[key] ?? key;
const q = (text) => `“${text}”`;
const person = (p) => (p ? p.name : '미지정');

const FIELD_DESCRIBERS = {
  title: (c) => `제목 ${q(c.from)} → ${q(c.to)}`,
  status: (c) => `상태 ${label(STATUS_LABELS, c.from)} → ${label(STATUS_LABELS, c.to)}`,
  priority: (c) => `우선순위 ${label(PRIORITY_LABELS, c.from)} → ${label(PRIORITY_LABELS, c.to)}`,
  startDate: (c) => `시작일 ${c.from ?? '없음'} → ${c.to ?? '없음'}`,
  dueDate: (c) => `마감일 ${c.from ?? '없음'} → ${c.to ?? '없음'}`,
  assignee: (c) => `담당자 ${person(c.from)} → ${person(c.to)}`,
  description: () => '설명 수정',
};

export function describeChanges(changes = {}) {
  return Object.keys(FIELD_DESCRIBERS)
    .filter((key) => changes[key] !== undefined)
    .map((key) => FIELD_DESCRIBERS[key](changes[key]));
}

// 작업 이력 화면(이미 어떤 작업인지 알고 있을 때)에서는 제목을 생략한다.
// API 토큰(AI 연동 등)으로 한 일은 사람이 한 일과 구분되도록 토큰 이름을 덧붙인다.
export const describeActivity = (a, options) =>
  describeBase(a, options) + (a.meta?.token ? ` (API 토큰: ${a.meta.token})` : '');

function describeBase(a, { showTask = true } = {}) {
  const m = a.meta ?? {};
  const task = (title) => (showTask && title ? `작업 ${q(title)}` : '작업');
  switch (a.action) {
    case 'project.created':
      return '프로젝트를 만들었습니다.';
    case 'project.updated': {
      const parts = [];
      if (m.changes?.name) parts.push(`이름 ${q(m.changes.name.from)} → ${q(m.changes.name.to)}`);
      if (m.changes?.status) {
        parts.push(m.changes.status.to === 'archived' ? '프로젝트를 보관' : '보관을 해제');
      }
      return `프로젝트 설정을 바꿨습니다. (${parts.join(', ')})`;
    }
    case 'member.added':
      return `${m.user?.name ?? '사용자'}님을 멤버로 추가했습니다.`;
    case 'member.removed':
      return `${m.user?.name ?? '사용자'}님을 멤버에서 제거했습니다.`;
    case 'task.created':
      return `${task(m.title)}을(를) 만들었습니다.${m.assignee ? ` (담당 ${m.assignee.name})` : ''}`;
    case 'task.updated':
      return `${task(m.title)}을(를) 수정했습니다. (${describeChanges(m.changes).join(', ')})`;
    case 'task.moved':
      return `${task(m.title)}을(를) ${label(STATUS_LABELS, m.from)} → ${label(STATUS_LABELS, m.to)}(으)로 옮겼습니다.${m.via === 'github' ? ' (GitHub)' : ''}`;
    case 'task.deleted':
      return `${task(m.title)}을(를) 삭제했습니다.`;
    case 'comment.created':
      return `${task(m.taskTitle)}에 댓글을 남겼습니다.`;
    case 'comment.deleted':
      return `${task(m.taskTitle)}의 댓글을 삭제했습니다.`;
    case 'github.connected':
      return `GitHub 저장소 ${m.repo}을(를) 연결했습니다.`;
    case 'github.disconnected':
      return `GitHub 저장소 ${m.repo} 연결을 해제했습니다.`;
    case 'github.linked':
      return `${task(m.title)}에 GitHub ${m.kind === 'pull_request' ? 'PR' : '커밋'} ${m.ref}이(가) 연결됐습니다.`;
    case 'github.pr_state':
      return `${task(m.title)}의 PR ${m.ref} 상태가 ${PR_STATE_LABELS[m.state] ?? m.state}(으)로 바뀌었습니다.`;
    case 'share.created':
      return `읽기 전용 공유 링크를 만들었습니다.${m.days ? ` (${m.days}일간 유효)` : ''}`;
    case 'share.revoked':
      return '공유 링크를 폐기했습니다.';
    default:
      return a.action;
  }
}

export const actorName = (a) => a.actor?.name ?? '알 수 없는 사용자';

export const formatWhen = (iso) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...hourCycle(),
  });
