import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, http } from '../../api/http.js';
import { describeDevice } from '../../constants/device.js';
import { formatWhen } from '../../constants/activity.js';

// 로그인한 기기 목록. 기기별로, 또는 지금 기기만 남기고 모두 로그아웃한다.
export default function SessionsCard() {
  const queryClient = useQueryClient();
  const key = ['sessions'];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => http.get('/auth/sessions').then((res) => res.data.data),
  });
  const [notice, setNotice] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const revoke = useMutation({
    mutationFn: (id) => http.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      setNotice('');
      refresh();
    },
  });
  const revokeOthers = useMutation({
    mutationFn: () => http.delete('/auth/sessions').then((res) => res.data),
    onSuccess: ({ revoked }) => {
      setNotice(`${revoked}개 기기에서 로그아웃했습니다.`);
      refresh();
    },
  });

  const sessions = data ?? [];
  const others = sessions.filter((s) => !s.current);
  const error = [revoke, revokeOthers].find((m) => m.isError)?.error;

  return (
    <section className="card settings-card" id="sessions" aria-label="로그인한 기기">
      <h2>로그인한 기기</h2>
      <p className="muted">
        내 계정에 로그인된 기기입니다. 모르는 기기가 있으면 로그아웃하고 비밀번호를 바꾸세요.
        로그아웃된 기기는 최대 15분 안에 접근이 끊깁니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {errorMessage(error, '처리하지 못했습니다.')}
        </p>
      )}
      {notice && (
        <p role="status" className="save-state">
          {notice}
        </p>
      )}
      <ul className="session-list">
        {sessions.map((s) => (
          <li key={s.id} className="session-item">
            <div>
              <strong>{describeDevice(s.device)}</strong>
              {s.current && <span className="badge session-current">지금 기기</span>}
              <span className="muted small">
                {s.ip ? `${s.ip} · ` : ''}마지막 사용 {formatWhen(s.lastUsedAt)}
              </span>
            </div>
            {!s.current && (
              <button
                type="button"
                className="secondary"
                disabled={revoke.isPending}
                aria-label={`${describeDevice(s.device)} 로그아웃`}
                onClick={() => revoke.mutate(s.id)}
              >
                로그아웃
              </button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <div className="row">
          <button
            type="button"
            className="danger"
            disabled={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            다른 모든 기기에서 로그아웃
          </button>
        </div>
      )}
    </section>
  );
}
