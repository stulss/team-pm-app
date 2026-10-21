import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDependency, listDependencies, removeDependency } from '../../api/dependencies.js';
import { listProjectTasks } from '../../api/tasks.js';
import { errorMessage } from '../../api/http.js';
import { STATUS_LABELS } from '../../constants/task.js';

function LinkedList({ items, onRemove, removing, label }) {
  return (
    <ul className="linked-list" aria-label={label}>
      {items.map((t) => (
        <li key={t.id}>
          <span className={t.status === 'done' ? 'linked-title done' : 'linked-title'}>
            {t.title}
          </span>
          <span className="badge">{STATUS_LABELS[t.status]}</span>
          {t.dueDate && <span className="muted small">{t.dueDate}</span>}
          {onRemove && (
            <button
              type="button"
              className="chip-x"
              aria-label={`"${t.title}" 선행 작업 해제`}
              disabled={removing}
              onClick={() => onRemove(t.id)}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// 작업 모달의 선행 작업 영역: 이 작업이 기다리는 작업을 지정·해제하고, 이 작업을 기다리는 작업을 보여 준다.
// 선행 작업이 끝나지 않아도 진행할 수 있다(경고 표시만 한다).
export default function DependencySection({ projectId, taskId, readOnly = false }) {
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState('');
  const key = ['dependencies', taskId];

  const deps = useQuery({ queryKey: key, queryFn: () => listDependencies(taskId) });
  const candidates = useQuery({
    queryKey: ['tasks', projectId, 'options'],
    queryFn: () => listProjectTasks(projectId, { limit: 200 }),
    enabled: !readOnly,
  });

  const refresh = (result) => {
    if (result)
      queryClient.setQueryData(key, { blockedBy: result.blockedBy, blocks: result.blocks });
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['task', taskId] });
  };
  const add = useMutation({
    mutationFn: () => addDependency(taskId, choice),
    onSuccess: (result) => {
      setChoice('');
      refresh(result);
    },
  });
  const remove = useMutation({
    mutationFn: (dependsOnId) => removeDependency(taskId, dependsOnId),
    onSuccess: refresh,
  });
  const error = add.error ?? remove.error;

  const blockedBy = deps.data?.blockedBy ?? [];
  const blocks = deps.data?.blocks ?? [];
  const taken = new Set([taskId, ...blockedBy.map((t) => t.id)]);
  const options = (candidates.data?.data ?? []).filter((t) => !taken.has(t.id));

  return (
    <section className="stack" aria-label="선행 작업">
      <h3>선행 작업</h3>
      <p className="muted small">여기서 고른 작업이 끝나야 이 작업을 시작할 수 있습니다.</p>
      {blockedBy.length === 0 && !deps.isPending && (
        <p className="muted small">지정된 선행 작업이 없습니다.</p>
      )}
      {blockedBy.length > 0 && (
        <LinkedList
          label="선행 작업 목록"
          items={blockedBy}
          removing={remove.isPending}
          onRemove={readOnly ? undefined : (id) => remove.mutate(id)}
        />
      )}
      {!readOnly && (
        <div className="row">
          <select
            aria-label="선행 작업 선택"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">작업 선택…</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({STATUS_LABELS[t.status]})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary"
            disabled={!choice || add.isPending}
            onClick={() => add.mutate()}
          >
            선행으로 지정
          </button>
        </div>
      )}
      {blocks.length > 0 && (
        <>
          <h4>이 작업을 기다리는 작업</h4>
          <LinkedList label="후행 작업 목록" items={blocks} />
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {errorMessage(error)}
        </p>
      )}
    </section>
  );
}
