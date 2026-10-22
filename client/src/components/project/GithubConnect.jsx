import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  connectGithub,
  disconnectGithub,
  getGithub,
  rotateGithubSecret,
} from '../../api/github.js';
import { errorMessage } from '../../api/http.js';
import { formatWhen } from '../../constants/activity.js';

// 프로젝트의 GitHub 저장소 연결. 소유자·Admin 만 쓴다(웹훅 비밀이 보인다).
export default function GithubConnect({ projectId }) {
  const queryClient = useQueryClient();
  const key = ['github', projectId];
  const [repo, setRepo] = useState('');
  const [reveal, setReveal] = useState(false);

  const { data } = useQuery({ queryKey: key, queryFn: () => getGithub(projectId) });
  const connection = data?.connection ?? null;

  const saved = (result) => queryClient.setQueryData(key, result);
  const connect = useMutation({
    mutationFn: (body) => connectGithub(projectId, body),
    onSuccess: (result) => {
      saved(result);
      setRepo('');
    },
  });
  const options = useMutation({
    mutationFn: (body) => connectGithub(projectId, { repo: connection.repo, ...body }),
    onSuccess: saved,
  });
  const rotate = useMutation({ mutationFn: () => rotateGithubSecret(projectId), onSuccess: saved });
  const disconnect = useMutation({
    mutationFn: () => disconnectGithub(projectId),
    onSuccess: () => {
      setReveal(false);
      queryClient.setQueryData(key, { connection: null });
    },
  });

  const error = [connect, options, rotate, disconnect].find((m) => m.isError)?.error;
  const submit = (e) => {
    e.preventDefault();
    connect.mutate({ repo });
  };

  return (
    <section className="github" aria-label="GitHub 연동">
      <h3>GitHub 연동</h3>
      <p className="muted small">
        PR 제목·브랜치·커밋 메시지에 작업 키(예: <code>ABC-12</code>)를 적으면 해당 작업에 자동으로
        연결됩니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {errorMessage(error, '요청에 실패했습니다.')}
        </p>
      )}

      {!connection ? (
        <form className="row" onSubmit={submit}>
          <input
            aria-label="GitHub 저장소"
            placeholder="owner/repo 또는 저장소 주소"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            maxLength={200}
            required
          />
          <button type="submit" disabled={connect.isPending}>
            {connect.isPending ? '연결 중…' : '연결'}
          </button>
        </form>
      ) : (
        <>
          <p>
            <strong>{connection.repo}</strong>
            <span className="muted small">
              {' '}
              ·{' '}
              {connection.lastEventAt
                ? `마지막 이벤트 ${formatWhen(connection.lastEventAt)}`
                : '아직 받은 이벤트 없음'}
            </span>
          </p>
          <label className="inline">
            <input
              type="checkbox"
              checked={connection.moveOnOpen}
              disabled={options.isPending}
              onChange={(e) => options.mutate({ moveOnOpen: e.target.checked })}
            />{' '}
            PR 이 열리면 할 일 → 진행 중으로 이동
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={connection.doneOnMerge}
              disabled={options.isPending}
              onChange={(e) => options.mutate({ doneOnMerge: e.target.checked })}
            />{' '}
            PR 이 머지되면 완료로 이동
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={connection.createOnPr}
              disabled={options.isPending}
              onChange={(e) => options.mutate({ createOnPr: e.target.checked })}
            />{' '}
            작업 키 없는 PR 을 작업 카드로 자동 등록
          </label>
          {connection.createOnPr && (
            <p className="muted small">
              작업 키(예: <code>ABC-12</code>)가 없는 PR 이 열리면 PR 제목으로 카드를 만들고 PR 을
              연결합니다. 초안 PR 은 준비되면 등록하고, 봇이 연 PR 은 등록하지 않습니다.
            </p>
          )}

          <details className="github-setup" open={!connection.lastEventAt}>
            <summary>GitHub 웹훅 설정 방법</summary>
            <ol className="small">
              <li>저장소 Settings → Webhooks → Add webhook</li>
              <li>
                Payload URL: <input readOnly aria-label="웹훅 주소" value={connection.webhookUrl} />
              </li>
              <li>
                Content type: <code>application/json</code>
              </li>
              <li>
                Secret:{' '}
                <input
                  readOnly
                  aria-label="웹훅 비밀"
                  type={reveal ? 'text' : 'password'}
                  value={connection.secret}
                />{' '}
                <button type="button" className="link" onClick={() => setReveal((v) => !v)}>
                  {reveal ? '숨기기' : '보기'}
                </button>
              </li>
              <li>
                이벤트: <strong>Pull requests</strong>, <strong>Pushes</strong>
              </li>
            </ol>
          </details>

          <div className="row">
            <button type="button" disabled={rotate.isPending} onClick={() => rotate.mutate()}>
              비밀 재발급
            </button>
            <button
              type="button"
              className="danger"
              disabled={disconnect.isPending}
              onClick={() => {
                if (
                  window.confirm('GitHub 연결을 해제할까요? 이미 연결된 PR·커밋 기록은 남습니다.')
                )
                  disconnect.mutate();
              }}
            >
              연결 해제
            </button>
          </div>
        </>
      )}
    </section>
  );
}
