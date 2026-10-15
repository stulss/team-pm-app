import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listMyTasks, updateTask } from '../api/tasks.js';
import { errorMessage } from '../api/http.js';
import { STATUSES, STATUS_LABELS, PRIORITY_LABELS, isOverdue } from '../constants/task.js';

export default function MyTasksPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');

  const params = { status: status || undefined, limit: 100 };
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['mytasks', params],
    queryFn: () => listMyTasks(params),
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, value }) => updateTask(id, { status: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mytasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  return (
    <>
      <div className="row between">
        <h1>내 작업</h1>
        <select aria-label="상태 필터" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">상태 전체</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {isPending && <p className="muted">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '작업을 불러오지 못했습니다.')}
        </p>
      )}
      {changeStatus.isError && (
        <p role="alert" className="error">
          {errorMessage(changeStatus.error)}
        </p>
      )}
      {data && data.data.length === 0 && (
        <p className="muted">
          {status ? '조건에 맞는 작업이 없습니다.' : '내게 배정된 작업이 없습니다.'}
        </p>
      )}

      {data && data.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>제목</th>
                <th>프로젝트</th>
                <th>상태</th>
                <th>우선순위</th>
                <th>마감일</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((t) => (
                <tr key={t.id}>
                  <td className="wrap">{t.title}</td>
                  <td>
                    <Link to={`/projects/${t.projectId}`}>{t.projectName}</Link>
                  </td>
                  <td>
                    <select
                      aria-label={`${t.title} 상태`}
                      value={t.status}
                      disabled={changeStatus.isPending}
                      onChange={(e) => changeStatus.mutate({ id: t.id, value: e.target.value })}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`badge badge-p-${t.priority}`}>
                      {PRIORITY_LABELS[t.priority]}
                    </span>
                  </td>
                  <td className={isOverdue(t) ? 'overdue' : ''}>
                    {t.dueDate ?? <span className="muted">-</span>}
                    {isOverdue(t) && ' (지연)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
