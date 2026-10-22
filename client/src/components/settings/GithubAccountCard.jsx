import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.jsx';
import { errorMessage, http } from '../../api/http.js';
import { githubErrorMessage } from '../../constants/githubLogin.js';

// 이메일 계정에 GitHub 계정을 연결·해제한다. 연결하면 GitHub 로 로그인할 수 있다.
export default function GithubAccountCard() {
  const { user, refreshUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const result = params.get('github');
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => http.get('/auth/providers').then((res) => res.data),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const [state, setState] = useState({ busy: false, error: '' });

  const linkedNow = result === 'linked';
  const flash = result ? githubErrorMessage(result) : '';

  const connect = async () => {
    setState({ busy: true, error: '' });
    try {
      const { data } = await http.post('/auth/github/link');
      window.location.assign(data.url);
    } catch (err) {
      setState({ busy: false, error: errorMessage(err, '연결을 시작하지 못했습니다.') });
    }
  };
  const disconnect = async () => {
    if (
      !window.confirm('GitHub 계정 연결을 해제할까요? 이후에는 이메일과 비밀번호로만 로그인합니다.')
    )
      return;
    setState({ busy: true, error: '' });
    try {
      await http.delete('/auth/github');
      setParams({}, { replace: true });
      await refreshUser();
      setState({ busy: false, error: '' });
    } catch (err) {
      setState({ busy: false, error: errorMessage(err, '해제하지 못했습니다.') });
    }
  };

  // 서버에 GitHub 로그인이 꺼져 있고 연결된 것도 없으면 보여 줄 게 없다
  if (!providers.data?.github && !user.githubLogin) return null;

  return (
    <section className="card settings-card" id="github" aria-label="GitHub 계정">
      <h2>GitHub 계정</h2>
      <p className="muted">
        연결하면 로그인 화면에서 “GitHub 로 계속하기”로 이 계정에 로그인할 수 있습니다.
      </p>
      {flash && (
        <p role={linkedNow ? 'status' : 'alert'} className={linkedNow ? 'save-state' : 'error'}>
          {flash}
        </p>
      )}
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {user.githubLogin ? (
        <div className="row">
          <span>
            <strong>@{user.githubLogin}</strong> 연결됨
          </span>
          <button type="button" className="secondary" disabled={state.busy} onClick={disconnect}>
            연결 해제
          </button>
        </div>
      ) : (
        <div className="row">
          <button type="button" disabled={state.busy} onClick={connect}>
            {state.busy ? '이동 중…' : 'GitHub 계정 연결'}
          </button>
        </div>
      )}
      {user.githubLogin && !user.emailLogin && (
        <p className="muted small">
          GitHub 로 가입한 계정이라 비밀번호가 없습니다. 연결을 해제하려면 로그인 화면의 “비밀번호
          찾기”로 먼저 비밀번호를 설정해 주세요.
        </p>
      )}
    </section>
  );
}
