import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createShareLink, listShareLinks, revokeShareLink, shareUrl } from '../../api/share.js';
import { errorMessage } from '../../api/http.js';
import { formatWhen } from '../../constants/activity.js';

const EXPIRY = [
  [1, '1일'],
  [7, '7일'],
  [30, '30일'],
];

// 활동 기록을 로그인 없이 읽기 전용으로 공유하는 링크 관리. Admin 과 프로젝트 소유자만 쓴다.
export default function ShareLinks({ projectId }) {
  const queryClient = useQueryClient();
  const key = ['share-links', projectId];
  const [days, setDays] = useState(7);
  const [created, setCreated] = useState(null); // { token, expiresAt } — 원문은 이 화면에서만 볼 수 있다
  const [copied, setCopied] = useState(false);

  const { data } = useQuery({ queryKey: key, queryFn: () => listShareLinks(projectId) });
  const create = useMutation({
    mutationFn: () => createShareLink(projectId, days),
    onSuccess: (link) => {
      setCreated(link);
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: (linkId) => revokeShareLink(projectId, linkId),
    onSuccess: () => {
      setCreated(null);
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(created.token));
      setCopied(true);
    } catch {
      setCopied(false); // 복사 권한이 없으면 입력창에서 직접 복사한다
    }
  };

  const links = data?.data ?? [];
  const error = [create, revoke].find((m) => m.isError)?.error;

  return (
    <section className="share" aria-label="공유 링크">
      <h3>읽기 전용 공유 링크</h3>
      <p className="muted small">
        링크를 아는 사람은 <strong>로그인 없이</strong> 이 프로젝트의 활동 기록(작업 제목, 담당자·
        행위자 이름 포함)을 볼 수 있습니다. 댓글 내용과 멤버 정보는 보이지 않으며, 언제든 폐기할 수
        있습니다.
      </p>
      <div className="row">
        <label className="inline">
          유효 기간{' '}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {EXPIRY.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? '만드는 중…' : '링크 만들기'}
        </button>
      </div>

      {error && (
        <p role="alert" className="error">
          {errorMessage(error, '요청에 실패했습니다.')}
        </p>
      )}

      {created && (
        <div className="notice" role="status">
          <p>
            <strong>새 링크가 만들어졌습니다.</strong> 이 링크는 지금만 볼 수 있으니 복사해 두세요.
          </p>
          <div className="row">
            <input
              readOnly
              aria-label="공유 링크 주소"
              value={shareUrl(created.token)}
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="secondary" onClick={copy}>
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
        </div>
      )}

      {links.length > 0 && (
        <ul className="members">
          {links.map((l) => (
            <li key={l.id}>
              <span>
                {formatWhen(l.createdAt)} 생성
                {l.createdBy ? ` · ${l.createdBy.name}` : ''} · 만료 {formatWhen(l.expiresAt)} ·
                조회 {l.viewCount}회
              </span>
              <button
                type="button"
                className="danger"
                disabled={revoke.isPending}
                onClick={() => {
                  if (window.confirm('이 링크를 폐기할까요? 폐기하면 바로 열 수 없게 됩니다.')) {
                    revoke.mutate(l.id);
                  }
                }}
              >
                폐기
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
