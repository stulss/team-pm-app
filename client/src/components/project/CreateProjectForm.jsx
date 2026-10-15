import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProject } from '../../api/projects.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';
import UserSearch from './UserSearch.jsx';

export default function CreateProjectForm({ onDone, onCancel }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState([]); // 본인(소유자)은 서버가 자동으로 넣는다

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onDone(project);
    },
  });

  const onSubmit = (e) => {
    e.preventDefault();
    mutation.mutate({
      name,
      description: description || undefined,
      memberIds: members.map((m) => m.id),
    });
  };

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>새 프로젝트</h2>
      <label>
        이름
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        설명 (선택)
        <textarea
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div>
        <span className="field-label">멤버</span>
        <ul className="chips">
          <li className="chip">{user.name} (나, 소유자)</li>
          {members.map((m) => (
            <li key={m.id} className="chip">
              {m.name}
              <button
                type="button"
                aria-label={`${m.name} 제거`}
                className="chip-x"
                onClick={() => setMembers((list) => list.filter((x) => x.id !== m.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <UserSearch
          excludeIds={[user.id, ...members.map((m) => m.id)]}
          onPick={(u) => setMembers((list) => [...list, u])}
        />
      </div>
      {mutation.isError && (
        <p role="alert" className="error">
          {errorMessage(mutation.error, '프로젝트를 만들지 못했습니다.')}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? '만드는 중…' : '만들기'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}
