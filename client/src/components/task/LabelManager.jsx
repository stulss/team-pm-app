import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createLabel, deleteLabel, listLabels, updateLabel } from '../../api/labels.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { COLOR_KEYS, LABEL_COLORS } from '../../constants/labels.js';
import Modal from '../common/Modal.jsx';

function LabelRow({ projectId, label, canManage, onChanged }) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const dirty = name.trim() !== label.name || color !== label.color;

  const save = useMutation({
    mutationFn: () => updateLabel(projectId, label.id, { name, color }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => deleteLabel(projectId, label.id),
    onSuccess: onChanged,
  });
  const error = save.error ?? remove.error;

  return (
    <li className="label-row">
      <span className={`label-chip lc-${color}`} aria-hidden="true">
        {'  '}
      </span>
      <input
        aria-label={`${label.name} 이름`}
        maxLength={30}
        disabled={!canManage}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        aria-label={`${label.name} 색`}
        disabled={!canManage}
        value={color}
        onChange={(e) => setColor(e.target.value)}
      >
        {COLOR_KEYS.map((k) => (
          <option key={k} value={k}>
            {LABEL_COLORS[k]}
          </option>
        ))}
      </select>
      {canManage && (
        <>
          <button
            type="button"
            className="secondary"
            disabled={!dirty || !name.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            저장
          </button>
          <button
            type="button"
            className="danger"
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `"${label.name}" 라벨을 삭제할까요? 붙어 있던 작업에서도 사라집니다.`,
                )
              )
                remove.mutate();
            }}
          >
            삭제
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error label-error">
          {errorMessage(error)}
        </p>
      )}
    </li>
  );
}

// 프로젝트 라벨 관리: 이름·색 변경과 삭제는 만든 사람·소유자·Admin 만(서버가 최종 검사).
export default function LabelManager({ project, archived, onClose }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['labels', project.id],
    queryFn: () => listLabels(project.id),
  });
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['labels', project.id] });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };
  const create = useMutation({
    mutationFn: () => createLabel(project.id, { name, color }),
    onSuccess: () => {
      setName('');
      refresh();
    },
  });

  const labels = data?.data ?? [];
  const canManage = (l) =>
    !archived && (user.role === 'admin' || project.ownerId === user.id || l.createdBy === user.id);

  return (
    <Modal title="라벨 관리" onClose={onClose}>
      <div className="stack">
        {isPending && <p className="muted">불러오는 중…</p>}
        {isError && (
          <p role="alert" className="error">
            {errorMessage(error, '라벨을 불러오지 못했습니다.')}
          </p>
        )}
        {!isPending && labels.length === 0 && <p className="muted">아직 라벨이 없습니다.</p>}
        <ul className="label-list">
          {labels.map((l) => (
            <LabelRow
              key={`${l.id}:${l.name}:${l.color}`}
              projectId={project.id}
              label={l}
              canManage={canManage(l)}
              onChanged={refresh}
            />
          ))}
        </ul>
        {!archived && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <input
              aria-label="새 라벨 이름"
              placeholder="새 라벨"
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select
              aria-label="새 라벨 색"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            >
              {COLOR_KEYS.map((k) => (
                <option key={k} value={k}>
                  {LABEL_COLORS[k]}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!name.trim() || create.isPending}>
              추가
            </button>
          </form>
        )}
        {create.isError && (
          <p role="alert" className="error">
            {errorMessage(create.error)}
          </p>
        )}
      </div>
    </Modal>
  );
}
