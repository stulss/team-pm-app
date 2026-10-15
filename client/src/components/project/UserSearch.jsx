import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listUsers } from '../../api/users.js';
import { useDebounced } from '../../hooks/useDebounced.js';

// 이름/이메일로 사용자를 검색해 고른다. excludeIds 에 있는 사용자와 비활성 사용자는 숨긴다.
export default function UserSearch({ onPick, excludeIds = [], disabled = false }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim());
  const { data, isFetching } = useQuery({
    queryKey: ['users', { q: debounced, picker: true }],
    queryFn: () => listUsers({ q: debounced || undefined, limit: 10 }),
    enabled: debounced.length > 0,
  });

  const candidates = (data?.data ?? []).filter((u) => u.isActive && !excludeIds.includes(u.id));

  return (
    <div className="user-search">
      <input
        type="search"
        placeholder="이름 또는 이메일로 검색"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
      />
      {debounced && (
        <ul className="results">
          {isFetching && <li className="muted">검색 중…</li>}
          {!isFetching && candidates.length === 0 && (
            <li className="muted">검색 결과가 없습니다.</li>
          )}
          {candidates.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  onPick(u);
                  setQ('');
                }}
              >
                {u.name} <span className="muted">{u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
