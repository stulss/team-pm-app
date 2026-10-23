import { useEffect, useRef, useState } from 'react';
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
import DependencySection from './DependencySection.jsx';
import GithubLinks from './GithubLinks.jsx';
import ActivityFeed from '../activity/ActivityFeed.jsx';
import { branchName } from '../../utils/taskKey.js';

// 속성 입력(오른쪽 패널)은 왼쪽의 <form> 밖에 있지만 form 속성으로 같은 폼에 묶여
// 저장 버튼과 Enter 로 함께 제출된다. 폼 안에 폼이 들어가는 것을 피하려고 이렇게 나눈다.
const FORM_ID = 'task-form';

// task 가 있으면 수정, 없으면 생성. members 는 담당자 후보(프로젝트 멤버).
export default function TaskModal({
  projectId,
  ownerId,
  members,
  task,
  readOnly = false,
  onDirtyChange,
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
    startDate: task?.startDate ?? '',
    dueDate: task?.dueDate ?? '',
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  // 처음 값에서 바뀌었는지: 바뀐 채로 닫으면(Esc·배경·취소) 확인을 받는다.
  const [initial] = useState(form);
  const dirty = !readOnly && JSON.stringify(form) !== JSON.stringify(initial);
  // 부모가 뒤로가기 등으로 닫힐 때도 확인할 수 있게 변경 여부를 알려 주고, 새로고침·탭 닫기도 막는다.
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (!dirty) return undefined;
    const warn = (e) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, onDirtyChange]);
  const leave = () => {
    onDirtyChange?.(false); // 확인을 마쳤거나 저장했으니 부모가 다시 묻지 않게 한다
    onClose();
  };
  const requestClose = () => {
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 그래도 닫을까요?')) return;
    leave();
  };
  // 더블클릭·연타로 같은 작업이 두 번 만들어지지 않게, 응답이 올 때까지 두 번째 제출을 막는다.
  const sending = useRef(false);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['mytasks'] });
    leave();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title,
        description: form.description || null,
        status: form.status,
        priority: form.priority,
        assigneeId: form.assigneeId || null,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
      };
      return editing ? updateTask(task.id, body) : createTask(projectId, body);
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => deleteTask(task.id), onSuccess: done });
  const error = save.error ?? remove.error;
  const [copied, setCopied] = useState('');
  // 키·브랜치 이름을 복사한다(클립보드를 못 쓰면 조용히 무시). GitHub 에 이 키를 쓰면 작업에 연결된다.
  const copy = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      /* 복사 실패는 무시 */
    }
  };

  // 현재 담당자가 (비활성 등으로) 후보에 없어도 선택값이 사라지지 않게 한다.
  const options = members.filter((m) => m.isActive || m.id === task?.assignee?.id);

  return (
    <Modal title={editing ? '작업 수정' : '새 작업'} onClose={requestClose} wide>
      <div className="task-layout">
        <form
          id={FORM_ID}
          className="task-top stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (readOnly || sending.current) return;
            sending.current = true;
            save.mutate(undefined, { onError: () => (sending.current = false) });
          }}
        >
          {editing && task.key && (
            <div className="task-key-line">
              <span className="task-key">{task.key}</span>
              <button type="button" className="linklike small" onClick={() => copy('키', task.key)}>
                키 복사
              </button>
              <button
                type="button"
                className="linklike small"
                onClick={() => copy('브랜치 이름', branchName(task))}
              >
                브랜치 이름 복사
              </button>
              <span role="status" className="save-state">
                {copied ? `${copied}을(를) 복사했습니다.` : ''}
              </span>
            </div>
          )}
          <label>
            제목
            <input
              className="task-title-input"
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
              rows={5}
              maxLength={10000}
              disabled={readOnly}
              placeholder="작업의 배경과 완료 조건을 적어 주세요."
              value={form.description}
              onChange={set('description')}
            />
          </label>

          {readOnly && <p className="notice">보관된 프로젝트의 작업은 수정할 수 없습니다.</p>}
          {error && (
            <p role="alert" className="error">
              {errorMessage(error)}
            </p>
          )}

          <div className="task-actions">
            <div>
              {editing && !readOnly && canDeleteTask(user, task, ownerId) && (
                <button
                  type="button"
                  className="danger-ghost"
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
              <button type="button" className="secondary" onClick={requestClose}>
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

        <aside className="task-side" aria-label="작업 속성">
          <section className="props">
            <h3>속성</h3>
            <label>
              상태
              <select
                form={FORM_ID}
                disabled={readOnly}
                value={form.status}
                onChange={set('status')}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              우선순위
              <select
                form={FORM_ID}
                disabled={readOnly}
                value={form.priority}
                onChange={set('priority')}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              담당자
              <select
                form={FORM_ID}
                disabled={readOnly}
                value={form.assigneeId}
                onChange={set('assigneeId')}
              >
                <option value="">미배정</option>
                {options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                시작일
                <input
                  form={FORM_ID}
                  type="date"
                  disabled={readOnly}
                  max={form.dueDate || undefined}
                  value={form.startDate}
                  onChange={set('startDate')}
                />
              </label>
              <label>
                마감일
                <input
                  form={FORM_ID}
                  type="date"
                  disabled={readOnly}
                  value={form.dueDate}
                  onChange={set('dueDate')}
                />
              </label>
            </div>
          </section>
          {editing && <TaskLabels projectId={projectId} task={task} readOnly={readOnly} />}
          {editing && (
            <DependencySection projectId={projectId} taskId={task.id} readOnly={readOnly} />
          )}
          {editing && <GithubLinks taskId={task.id} />}
          {!editing && (
            <p className="muted small">
              작업을 만들면 라벨·체크리스트·선행 작업·댓글을 추가할 수 있습니다.
            </p>
          )}
        </aside>

        {editing && (
          <div className="task-rest">
            <ChecklistSection taskId={task.id} readOnly={readOnly} />
            <CommentSection
              taskId={task.id}
              ownerId={ownerId}
              members={members}
              readOnly={readOnly}
            />
            <ActivityFeed projectId={projectId} taskId={task.id} title="변경 이력" limit={10} />
          </div>
        )}
      </div>
    </Modal>
  );
}
