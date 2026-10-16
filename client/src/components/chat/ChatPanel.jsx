import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteChat, listChat, sendChat } from '../../api/chat.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatWhen } from '../../constants/activity.js';
import { activeMentionIds, renderWithMentions } from '../../utils/mentions.js';
import MentionTextarea from '../task/MentionTextarea.jsx';

const MAX_LENGTH = 2000;

// 프로젝트 채팅방(프로젝트당 1개). 본문은 항상 텍스트로 렌더링한다(HTML 로 해석하지 않음).
// 다른 사용자의 메시지는 프로젝트 화면의 실시간 구독이 ['chat', projectId] 를 갱신해 반영된다.
export default function ChatPanel({ project, archived = false }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = ['chat', project.id];
  const logRef = useRef(null);

  const { data, isPending, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: key,
      queryFn: ({ pageParam }) => listChat(project.id, { before: pageParam }),
      initialPageParam: undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    });

  // 서버는 최신순으로 주므로 화면에서는 뒤집어 아래가 최신이 되게 한다.
  const messages = (data?.pages ?? []).flatMap((p) => p.data).reverse();
  const newestId = messages[messages.length - 1]?.id;

  // 새 메시지가 오면 맨 아래로(이전 메시지를 더 불러올 때는 newestId 가 그대로라 움직이지 않는다).
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newestId]);

  const [text, setText] = useState('');
  const [mentions, setMentions] = useState([]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const send = useMutation({
    mutationFn: (body) => sendChat(project.id, body, activeMentionIds(body, mentions)),
    onSuccess: () => {
      setText('');
      setMentions([]);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id) => deleteChat(project.id, id),
    onSuccess: refresh,
  });
  const mutationError = [send, remove].find((m) => m.isError)?.error;

  const canDelete = (m) =>
    !archived && (m.author?.id === user.id || user.role === 'admin' || project.ownerId === user.id);
  const submit = () => {
    if (!send.isPending && text.trim()) send.mutate(text);
  };

  return (
    <section className="chat" aria-label="프로젝트 채팅">
      <h2>채팅</h2>
      {isPending && <p className="muted small">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '채팅을 불러오지 못했습니다.')}
        </p>
      )}
      {!isPending && !isError && (
        <div className="chat-log" ref={logRef} tabIndex={0} aria-label="대화 내용">
          {hasNextPage && (
            <button
              type="button"
              className="secondary"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {isFetchingNextPage ? '불러오는 중…' : '이전 메시지 더 보기'}
            </button>
          )}
          {messages.length === 0 && <p className="muted small">아직 대화가 없습니다.</p>}
          <ul className="chat-list">
            {messages.map((m) => (
              <li key={m.id} className={m.author?.id === user.id ? 'chat-msg mine' : 'chat-msg'}>
                <div className="chat-meta">
                  <strong>{m.author?.name ?? '알 수 없는 사용자'}</strong>
                  <time className="muted small" dateTime={m.createdAt}>
                    {formatWhen(m.createdAt)}
                  </time>
                  {canDelete(m) && (
                    <button
                      type="button"
                      className="linklike small"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm('이 메시지를 삭제할까요?')) remove.mutate(m.id);
                      }}
                    >
                      삭제
                    </button>
                  )}
                </div>
                <p className="chat-body">{renderWithMentions(m.body, m.mentions)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mutationError && (
        <p role="alert" className="error">
          {errorMessage(mutationError)}
        </p>
      )}
      {archived ? (
        <p className="muted small">보관된 프로젝트에서는 메시지를 보낼 수 없습니다.</p>
      ) : (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <MentionTextarea
            rows={2}
            maxLength={MAX_LENGTH}
            aria-label="채팅 메시지"
            placeholder="메시지 (@멘션, Enter 전송)"
            title="Enter 전송, Shift+Enter 줄바꿈, @ 로 멤버 멘션"
            value={text}
            onChange={setText}
            mentions={mentions}
            onMentionsChange={setMentions}
            members={project.members}
            meId={user.id}
            onKeyDown={(e) => {
              // 한글 조합 중의 Enter 는 글자 확정이므로 전송하지 않는다.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="submit" disabled={send.isPending || !text.trim()}>
            보내기
          </button>
        </form>
      )}
    </section>
  );
}
