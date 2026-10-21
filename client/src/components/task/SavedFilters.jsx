import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSavedFilter, deleteSavedFilter, listSavedFilters } from '../../api/savedFilters.js';
import { errorMessage } from '../../api/http.js';
import { applySaved, currentFilters } from '../../utils/savedFilters.js';

// 개인용 저장된 필터: 고르면 적용, "현재 필터 저장" 으로 이름을 붙여 저장, 고른 것은 삭제.
export default function SavedFilters({ projectId, filters, q, labelIds, memberIds, onApply }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const { data } = useQuery({
    queryKey: ['saved-filters', projectId],
    queryFn: () => listSavedFilters(projectId),
  });
  const items = data?.data ?? [];
  const current = currentFilters(filters, q);
  const canSave = Object.keys(current).length > 0;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['saved-filters', projectId] });
  const save = useMutation({
    mutationFn: () => createSavedFilter(projectId, { name, filters: current }),
    onSuccess: (created) => {
      setName('');
      setNaming(false);
      setSelected(created.id);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteSavedFilter(projectId, selected),
    onSuccess: () => {
      setSelected('');
      refresh();
    },
  });
  const error = save.error ?? remove.error;

  const choose = (e) => {
    const id = e.target.value;
    setSelected(id);
    const saved = items.find((f) => f.id === id);
    if (saved) onApply(applySaved(saved, { labelIds, memberIds }));
  };

  return (
    <div className="filters saved-filters">
      <select aria-label="저장된 필터" value={selected} onChange={choose}>
        <option value="">저장된 필터</option>
        {items.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      {selected && (
        <button
          type="button"
          className="secondary"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          기억 지우기
        </button>
      )}
      {!naming ? (
        <button
          type="button"
          className="secondary"
          disabled={!canSave}
          title={canSave ? undefined : '기억할 필터 조건이 없습니다.'}
          onClick={() => setNaming(true)}
        >
          이 조건 기억하기
        </button>
      ) : (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
        >
          <input
            aria-label="기억할 필터 이름"
            placeholder="필터 이름"
            maxLength={40}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" disabled={!name.trim() || save.isPending}>
            기억
          </button>
          <button type="button" className="secondary" onClick={() => setNaming(false)}>
            취소
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {errorMessage(error)}
        </p>
      )}
    </div>
  );
}
