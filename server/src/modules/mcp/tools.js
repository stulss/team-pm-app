import { z } from 'zod';
import { TASK_KEY_PATTERN } from '../projects/key.js';

// MCP 도구. 각 도구는 기존 REST API 를 같은 프로세스에서 호출한다(api 함수) — 그래서 토큰 범위·프로젝트 권한·검증·
// 실시간 이벤트·활동 기록이 REST 와 똑같이 적용되고, 여기서는 인자 모양만 다룬다.

export class ToolError extends Error {}

const STATUSES = ['todo', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const uuid = (what) => z.uuid(`${what} 은(는) UUID 여야 합니다.`);
const taskRef = z
  .string()
  .trim()
  .min(1)
  .describe('작업 키(예: TPM-12) 또는 작업 ID. list_tasks·get_task 결과의 key 를 쓰면 된다.');
const project = uuid('project').describe('프로젝트 ID (list_projects 결과의 id)');
const date = z.iso.date().describe('YYYY-MM-DD');
const taskFields = {
  title: z.string().trim().min(1).max(200).describe('제목'),
  description: z.string().max(10_000).describe('설명'),
  status: z.enum(STATUSES).describe('상태'),
  priority: z.enum(PRIORITIES).describe('우선순위'),
  startDate: date.describe('시작일 YYYY-MM-DD'),
  dueDate: date.describe('마감일 YYYY-MM-DD'),
  assigneeId: uuid('assigneeId').describe('담당자 사용자 ID'),
};

// 키 또는 UUID → 작업 ID. 키는 서버에 한 번 물어 변환한다(권한 검사는 그 요청이 한다).
async function taskId(ref, api) {
  if (TASK_KEY_PATTERN.test(ref)) {
    return (await api('GET', `/tasks/key/${encodeURIComponent(ref)}`)).id;
  }
  if (!z.uuid().safeParse(ref).success) {
    throw new ToolError('task 는 작업 키(예: TPM-12) 또는 작업 ID 여야 합니다.');
  }
  return ref;
}

const omitUndefined = (o) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export const TOOLS = [
  {
    name: 'list_projects',
    description: '내가 속한 프로젝트 목록(id, name, key, 상태).',
    write: false,
    input: z.object({ status: z.enum(['active', 'archived']).optional() }),
    run: (a, api) => api('GET', '/projects', { query: { limit: 100, ...omitUndefined(a) } }),
  },
  {
    name: 'list_tasks',
    description: '프로젝트의 작업 목록. 상태·담당자·검색어로 거를 수 있다.',
    write: false,
    input: z.object({
      project,
      status: z.enum(STATUSES).optional(),
      assignee: z.union([z.literal('me'), z.literal('unassigned'), uuid('assignee')]).optional(),
      q: z.string().trim().max(100).optional().describe('제목·설명 검색어'),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: ({ project: id, ...query }, api) =>
      api('GET', `/projects/${id}/tasks`, { query: { limit: 50, ...omitUndefined(query) } }),
  },
  {
    name: 'my_tasks',
    description: '나에게 배정된 작업(내가 속한 모든 프로젝트).',
    write: false,
    input: z.object({
      status: z.enum(STATUSES).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: (a, api) => api('GET', '/tasks/mine', { query: { limit: 50, ...omitUndefined(a) } }),
  },
  {
    name: 'get_task',
    description: '작업 한 건의 상세(설명·담당자·마감일·라벨·체크리스트·연결된 PR).',
    write: false,
    input: z.object({ task: taskRef }),
    run: async ({ task }, api) =>
      TASK_KEY_PATTERN.test(task)
        ? api('GET', `/tasks/key/${encodeURIComponent(task)}`)
        : api('GET', `/tasks/${await taskId(task, api)}`),
  },
  {
    name: 'search',
    description: '프로젝트·작업·댓글·채팅을 통합 검색한다(내가 접근할 수 있는 것만).',
    write: false,
    input: z.object({
      q: z.string().trim().min(2).max(50),
      type: z.enum(['all', 'project', 'task', 'comment', 'chat']).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    run: (a, api) => api('GET', '/search', { query: omitUndefined(a) }),
  },
  {
    name: 'list_comments',
    description: '작업의 댓글 목록(작성순).',
    write: false,
    input: z.object({ task: taskRef }),
    run: async ({ task }, api) => api('GET', `/tasks/${await taskId(task, api)}/comments`),
  },
  {
    name: 'create_task',
    description: '프로젝트에 작업을 만든다. 상태 기본값은 todo, 우선순위 기본값은 medium.',
    write: true,
    input: z.object({
      project,
      title: taskFields.title,
      description: taskFields.description.optional(),
      status: taskFields.status.optional(),
      priority: taskFields.priority.optional(),
      startDate: taskFields.startDate.optional(),
      dueDate: taskFields.dueDate.optional(),
      assigneeId: taskFields.assigneeId.optional(),
    }),
    run: ({ project: id, ...body }, api) => api('POST', `/projects/${id}/tasks`, { body }),
  },
  {
    name: 'update_task',
    description: '작업의 제목·설명·상태·우선순위·날짜·담당자를 바꾼다. 보낸 항목만 바뀐다.',
    write: true,
    input: z.object({
      task: taskRef,
      title: taskFields.title.optional(),
      description: taskFields.description.nullable().optional(),
      status: taskFields.status.optional(),
      priority: taskFields.priority.optional(),
      startDate: taskFields.startDate.nullable().optional(),
      dueDate: taskFields.dueDate.nullable().optional(),
      assigneeId: taskFields.assigneeId.nullable().optional().describe('null 이면 담당 해제'),
    }),
    run: async ({ task, ...body }, api) =>
      api('PATCH', `/tasks/${await taskId(task, api)}`, { body: omitUndefined(body) }),
  },
  {
    name: 'move_task',
    description: '작업을 다른 상태 컬럼의 맨 아래로 옮긴다.',
    write: true,
    input: z.object({ task: taskRef, status: taskFields.status }),
    run: async ({ task, status }, api) =>
      api('PATCH', `/tasks/${await taskId(task, api)}/move`, { body: { status } }),
  },
  {
    name: 'add_comment',
    description: '작업에 댓글을 남긴다(5000자까지).',
    write: true,
    input: z.object({ task: taskRef, body: z.string().trim().min(1).max(5000) }),
    run: async ({ task, body }, api) =>
      api('POST', `/tasks/${await taskId(task, api)}/comments`, { body: { body } }),
  },
];

export const toolDescriptors = (scope) =>
  TOOLS.filter((t) => scope === 'write' || !t.write).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { io: 'input' }),
  }));
