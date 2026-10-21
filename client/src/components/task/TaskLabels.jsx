import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createLabel, listLabels, setTaskLabels } from '../../api/labels.js';
import { getTask } from '../../api/tasks.js';
import { errorMessage } from '../../api/http.js';
import { COLOR_KEYS, LABEL_COLORS } from '../../constants/labels.js';

// 작업 모달의 라벨 영역. 프로젝트 라벨을 켜고 끄고, 새 라벨을 만들면 바로 이 작업에 붙인다.
// 현재 붙은 라벨은 ['task', id] 캐시를 기준으로 보여 준다(모달이 들고 있는 task 는 열 때의 스냅숏이라서).
export default function TaskLabels({ projectId, task, readOnly = false }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');

  const labels = useQuery({
    queryKey: ['labels', projectId],
    queryFn: () => listLabels(projectId),
  });
  const current = useQuery({
    queryKey: ['task', task.id],
    queryFn: () => getTask(task.id),
    initialData: task,
  });
  const attached = new Set((current.data?.labels ?? []).map((l) => l.id));

  const apply = useMutation({
    mutationFn: (ids) => setTaskLabels(task.id, ids),
    onSuccess: (updated) => {
      queryClient.setQueryData(['task', task.id], updated);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['mytasks'] });
    },
  });
  const create = useMutation({
    mutationFn: () => createLabel(projectId, { name, color }),
    onSuccess: (label) => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['labels', projectId] });
      apply.mutate([...attached, label.id]);
    },
  });

  const toggle = (id) => {
    const next = new Set(attached);
    if (!next.delete(id)) next.add(id);
    apply.mutate([...next]);
  };
  const error = apply.error ?? create.error;
  const all = labels.data?.data ?? [];

  return (
    <section className="stack" aria-label="라벨">
      <h3>라벨</h3>
      {all.length === 0 && <p className="muted small">아직 라벨이 없습니다.</p>}
      <ul className="chips" aria-label="프로젝트 라벨">
        {all.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              className={`label-toggle label-chip lc-${l.color}${attached.has(l.id) ? ' on' : ''}`}
              aria-pressed={attached.has(l.id)}
              disabled={readOnly || apply.isPending}
              onClick={() => toggle(l.id)}
            >
              {l.name}
            </button>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="row">
          <input
            aria-label="새 라벨 이름"
            placeholder="새 라벨"
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select aria-label="새 라벨 색" value={color} onChange={(e) => setColor(e.target.value)}>
            {COLOR_KEYS.map((k) => (
              <option key={k} value={k}>
                {LABEL_COLORS[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            만들고 붙이기
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {errorMessage(error)}
        </p>
      )}
    </section>
  );
}
