import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addChecklistItem,
  deleteChecklistItem,
  listChecklist,
  updateChecklistItem,
} from '../../api/checklist.js';
import { errorMessage } from '../../api/http.js';

// 작업 모달의 체크리스트(하위 작업). 변경하면 카드의 진행률도 갱신되도록 작업 목록을 다시 불러온다.
// 다른 사용자의 변경은 프로젝트 화면의 실시간 구독이 ['checklist', taskId] 를 갱신해 반영된다.
export default function ChecklistSection({ taskId, readOnly = false }) {
  const queryClient = useQueryClient();
  const key = ['checklist', taskId];
  const [text, setText] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: key,
    queryFn: () => listChecklist(taskId),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['mytasks'] });
  };

  const add = useMutation({
    mutationFn: () => addChecklistItem(taskId, text),
    onSuccess: () => {
      setText('');
      refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, isDone }) => updateChecklistItem(taskId, id, { isDone }),
    // 체크는 바로 보이게 하고, 실패하면 서버 상태로 되돌린다.
    onMutate: async ({ id, isDone }) => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(
        key,
        (old) => old && { data: old.data.map((i) => (i.id === id ? { ...i, isDone } : i)) },
      );
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id) => deleteChecklistItem(taskId, id),
    onSuccess: refresh,
  });
  const mutationError = [add, toggle, remove].find((m) => m.isError)?.error;

  const items = data?.data ?? [];
  const done = items.filter((i) => i.isDone).length;
  const percent = items.length === 0 ? 0 : Math.round((done / items.length) * 100);

  return (
    <section className="stack" aria-label="체크리스트">
      <div className="row between">
        <h3>체크리스트</h3>
        {items.length > 0 && (
          <span className="muted small" data-testid="checklist-progress">
            {done}/{items.length}
          </span>
        )}
      </div>
      {items.length > 0 && (
        <div
          className="progress"
          role="progressbar"
          aria-label="체크리스트 진행률"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress-bar" style={{ width: `${percent}%` }} />
        </div>
      )}
      {isPending && <p className="muted small">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '체크리스트를 불러오지 못했습니다.')}
        </p>
      )}
      {!isPending && items.length === 0 && <p className="muted small">항목이 없습니다.</p>}
      <ul className="checklist">
        {items.map((item) => (
          <li key={item.id}>
            <label className={item.isDone ? 'check done' : 'check'}>
              <input
                type="checkbox"
                checked={item.isDone}
                disabled={readOnly}
                onChange={(e) => toggle.mutate({ id: item.id, isDone: e.target.checked })}
              />
              <span>{item.content}</span>
            </label>
            {!readOnly && (
              <button
                type="button"
                className="chip-x"
                aria-label={`"${item.content}" 항목 삭제`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(item.id)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate();
          }}
        >
          <input
            aria-label="체크리스트 항목"
            placeholder="항목 추가"
            maxLength={200}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="secondary" disabled={!text.trim() || add.isPending}>
            추가
          </button>
        </form>
      )}
      {mutationError && (
        <p role="alert" className="error">
          {errorMessage(mutationError)}
        </p>
      )}
    </section>
  );
}
