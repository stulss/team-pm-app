import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listUsers, setUserRole, setUserStatus } from '../api/users.js';
import { errorMessage } from '../api/http.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useDebounced } from '../hooks/useDebounced.js';

const LIMIT = 20;
const ROLES = ['admin', 'manager', 'member'];

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(q.trim());

  const params = { q: debounced || undefined, page, limit: LIMIT };
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['users', params],
    queryFn: () => listUsers(params),
    placeholderData: (prev) => prev,
  });

  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const role = useMutation({ mutationFn: ({ id, value }) => setUserRole(id, value), onSuccess });
  const status = useMutation({
    mutationFn: ({ id, isActive }) => setUserStatus(id, isActive),
    onSuccess,
  });
  const mutationError = [role, status].find((m) => m.isError)?.error;
  const totalPages = data ? Math.max(1, Math.ceil(data.meta.total / LIMIT)) : 1;

  return (
    <>
      <h1>사용자 관리</h1>
      <input
        type="search"
        placeholder="이름 또는 이메일로 검색"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />

      {isPending && <p className="muted">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '사용자 목록을 불러오지 못했습니다.')}
        </p>
      )}
      {mutationError && (
        <p role="alert" className="error">
          {errorMessage(mutationError)}
        </p>
      )}

      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>역할</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((u) => (
                <tr key={u.id} className={u.isActive ? '' : 'inactive'}>
                  <td>
                    {u.name} {u.id === me.id && <span className="muted">(나)</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      aria-label={`${u.name} 역할`}
                      value={u.role}
                      disabled={role.isPending}
                      onChange={(e) => role.mutate({ id: u.id, value: e.target.value })}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      disabled={status.isPending}
                      onClick={() => status.mutate({ id: u.id, isActive: !u.isActive })}
                    >
                      {u.isActive ? '활성 → 비활성화' : '비활성 → 활성화'}
                    </button>
                  </td>
                </tr>
              ))}
              {data.data.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    사용자가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && totalPages > 1 && (
        <div className="row">
          <button
            type="button"
            className="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            이전
          </button>
          <span className="muted">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </button>
        </div>
      )}
    </>
  );
}
