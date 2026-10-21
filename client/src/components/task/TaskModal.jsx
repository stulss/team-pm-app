import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTask, deleteTask, updateTask } from '../../api/tasks.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  canDeleteTask,
} from '../../constants/task.js';
import Modal from '../common/Modal.jsx';
import CommentSection from './CommentSection.jsx';
import TaskLabels from './TaskLabels.jsx';
import ChecklistSection from './ChecklistSection.jsx';
import ActivityFeed from '../activity/ActivityFeed.jsx';

// task 가 있으면 수정, 없으면 생성. members 는 담당자 후보(프로젝트 멤버).
export default function TaskModal({
  projectId,
  ownerId,
  members,
  task,
  readOnly = false,
  onClose,
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const editing = Boolean(task);

  const [form, setForm] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: task?.status ?? 'todo',
    priority: task?.priority ?? 'medium',
    assigneeId: task?.assignee?.id ?? '',
    dueDate: task?.dueDate ?? '',
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['mytasks'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title,
        description: form.description || null,
        status: form.status,
        priority: form.priority,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
      };
      return editing ? updateTask(task.id, body) : createTask(projectId, body);
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => deleteTask(task.id), onSuccess: done });
  const error = save.error ?? remove.error;

  // 현재 담당자가 (비활성 등으로) 후보에 없어도 선택값이 사라지지 않게 한다.
  const options = members.filter((m) => m.isActive || m.id === task?.assignee?.id);

  return (
    <Modal title={editing ? '작업 수정' : '새 작업'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!readOnly) save.mutate();
        }}
      >
        <label>
          제목
          <input
            required
            maxLength={200}
            autoFocus
            disabled={readOnly}
            value={form.title}
            onChange={set('title')}
          />
        </label>
        <label>
          설명
          <textarea
            rows={4}
            maxLength={10000}
            disabled={readOnly}
            value={form.description}
            onChange={set('description')}
          />
        </label>
        <div className="form-grid">
          <label>
            상태
            <select disabled={readOnly} value={form.status} onChange={set('status')}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            우선순위
            <select disabled={readOnly} value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            담당자
            <select disabled={readOnly} value={form.assigneeId} onChange={set('assigneeId')}>
              <option value="">미배정</option>
              {options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            마감일
            <input type="date" disabled={readOnly} value={form.dueDate} onChange={set('dueDate')} />
          </label>
        </div>

        {readOnly && <p className="muted">보관된 프로젝트의 작업은 수정할 수 없습니다.</p>}
        {error && (
          <p role="alert" className="error">
            {errorMessage(error)}
          </p>
        )}

        <div className="row between">
          <div>
            {editing && !readOnly && canDeleteTask(user, task, ownerId) && (
              <button
                type="button"
                className="danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`"${task.title}" 작업을 삭제할까요?`)) remove.mutate();
                }}
              >
                삭제
              </button>
            )}
          </div>
          <div className="row">
            <button type="button" className="secondary" onClick={onClose}>
              {readOnly ? '닫기' : '취소'}
            </button>
            {!readOnly && (
              <button type="submit" disabled={save.isPending}>
                {save.isPending ? '저장 중…' : editing ? '저장' : '만들기'}
              </button>
            )}
          </div>
        </div>
      </form>
      {editing && <TaskLabels projectId={projectId} task={task} readOnly={readOnly} />}
      {editing && <ChecklistSection taskId={task.id} readOnly={readOnly} />}
      {editing && (
        <CommentSection taskId={task.id} ownerId={ownerId} members={members} readOnly={readOnly} />
      )}
      {editing && (
        <ActivityFeed projectId={projectId} taskId={task.id} title="변경 이력" limit={10} />
      )}
    </Modal>
  );
}
