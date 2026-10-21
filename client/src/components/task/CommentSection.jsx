import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createComment,
  deleteComment,
  listComments,
  reactComment,
  updateComment,
} from '../../api/comments.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { activeMentionIds, renderWithMentions } from '../../utils/mentions.js';
import { buildThreads } from '../../utils/threads.js';
import MentionTextarea from './MentionTextarea.jsx';
import ReactionBar from '../common/ReactionBar.jsx';
import Avatar from '../common/Avatar.jsx';

const formatTime = (iso) =>
  new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

// 작업 모달의 댓글 영역. 본문은 항상 텍스트로 렌더링한다(HTML 로 해석하지 않음).
// 댓글에는 한 단계 답글을 달 수 있다(스레드). 서버는 작성순 평면 배열을 주고, 묶는 것은 여기서 한다.
// 다른 사용자의 변경은 프로젝트 화면의 실시간 구독이 ['comments', taskId] 를 갱신해 반영된다.
export default function CommentSection({ taskId, ownerId, members = [], readOnly = false }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = ['comments', taskId];

  const { data, isPending, isError, error } = useQuery({
    queryKey: key,
    queryFn: () => listComments(taskId),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['tasks'] }); // 댓글 수 배지
    queryClient.invalidateQueries({ queryKey: ['mytasks'] });
  };

  const [text, setText] = useState('');
  const [mentions, setMentions] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editMentions, setEditMentions] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyMentions, setReplyMentions] = useState([]);

  const add = useMutation({
    mutationFn: ({ body, picked, parentId }) =>
      createComment(taskId, body, activeMentionIds(body, picked), parentId),
    onSuccess: (_created, { parentId }) => {
      if (parentId) {
        setReplyingTo(null);
        setReplyText('');
        setReplyMentions([]);
      } else {
        setText('');
        setMentions([]);
      }
      refresh();
    },
  });
  const save = useMutation({
    mutationFn: ({ id, body }) => updateComment(id, body, activeMentionIds(body, editMentions)),
    onSuccess: () => {
      setEditingId(null);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id) => deleteComment(id), onSuccess: refresh });
  const react = useMutation({
    mutationFn: ({ id, key, on }) => reactComment(id, key, on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const mutationError = [add, save, remove, react].find((m) => m.isError)?.error;

  const comments = data?.data ?? [];
  const threads = buildThreads(comments);
  const canDelete = (c) =>
    !readOnly &&
    !c.deleted &&
    (c.author.id === user.id ||
      user.role === 'admin' ||
      user.role === 'manager' ||
      ownerId === user.id);

  // 댓글 하나(최상위든 답글이든)의 머리글·본문·반응. 답글 버튼은 최상위 댓글에만 있다.
  const renderComment = (c, { canReply }) => (
    <>
      <div className="comment-meta">
        <Avatar name={c.author.name} size="sm" />
        <strong>{c.author.name}</strong>
        <span className="muted small">{formatTime(c.createdAt)}</span>
        {c.edited && <span className="muted small">(수정됨)</span>}
        <span className="spacer" />
        {canReply && !readOnly && !c.deleted && (
          <button
            type="button"
            className="linklike small"
            aria-expanded={replyingTo === c.id}
            onClick={() => setReplyingTo(replyingTo === c.id ? null : c.id)}
          >
            답글
          </button>
        )}
        {!readOnly && !c.deleted && c.author.id === user.id && editingId !== c.id && (
          <button
            type="button"
            className="linklike small"
            onClick={() => {
              setEditingId(c.id);
              setEditText(c.body);
              setEditMentions(c.mentions ?? []);
            }}
          >
            수정
          </button>
        )}
        {canDelete(c) && (
          <button
            type="button"
            className="linklike small"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm('이 댓글을 삭제할까요?')) remove.mutate(c.id);
            }}
          >
            삭제
          </button>
        )}
      </div>
      {editingId === c.id ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ id: c.id, body: editText });
          }}
        >
          <MentionTextarea
            rows={3}
            maxLength={5000}
            aria-label="댓글 수정"
            value={editText}
            onChange={setEditText}
            mentions={editMentions}
            onMentionsChange={setEditMentions}
            members={members}
            meId={user.id}
          />
          <div className="row">
            <button type="submit" disabled={save.isPending || !editText.trim()}>
              저장
            </button>
            <button type="button" className="secondary" onClick={() => setEditingId(null)}>
              취소
            </button>
          </div>
        </form>
      ) : (
        <p className={c.deleted ? 'comment-body muted' : 'comment-body'}>
          {c.deleted ? c.body : renderWithMentions(c.body, c.mentions)}
        </p>
      )}
      {!c.deleted && editingId !== c.id && (
        <ReactionBar
          reactions={c.reactions}
          meId={user.id}
          readOnly={readOnly}
          pending={react.isPending}
          onToggle={(emoji, on) => react.mutate({ id: c.id, key: emoji, on })}
        />
      )}
    </>
  );

  return (
    <section className="comments" aria-label="댓글">
      <h3>댓글 {comments.filter((c) => !c.deleted).length || ''}</h3>

      {isPending && <p className="muted small">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '댓글을 불러오지 못했습니다.')}
        </p>
      )}
      {data && comments.length === 0 && <p className="muted small">아직 댓글이 없습니다.</p>}

      <ul className="comment-list">
        {threads.map(({ comment: c, replies }) => (
          <li key={c.id} className="comment" data-comment-id={c.id}>
            {renderComment(c, { canReply: true })}
            {(replies.length > 0 || replyingTo === c.id) && (
              <ul className="reply-list" aria-label={`${c.author.name}님의 댓글에 달린 답글`}>
                {replies.map((r) => (
                  <li key={r.id} className="comment reply" data-comment-id={r.id}>
                    {renderComment(r, { canReply: false })}
                  </li>
                ))}
                {replyingTo === c.id && (
                  <li className="reply-form">
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (replyText.trim()) {
                          add.mutate({ body: replyText, picked: replyMentions, parentId: c.id });
                        }
                      }}
                    >
                      <MentionTextarea
                        rows={2}
                        maxLength={5000}
                        aria-label="답글 내용"
                        placeholder="답글을 입력하세요 (@ 로 멤버를 멘션)"
                        autoFocus
                        value={replyText}
                        onChange={setReplyText}
                        mentions={replyMentions}
                        onMentionsChange={setReplyMentions}
                        members={members}
                        meId={user.id}
                      />
                      <div className="row">
                        <button type="submit" disabled={add.isPending || !replyText.trim()}>
                          답글 등록
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setReplyingTo(null)}
                        >
                          취소
                        </button>
                      </div>
                    </form>
                  </li>
                )}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {mutationError && (
        <p role="alert" className="error">
          {errorMessage(mutationError)}
        </p>
      )}

      {!readOnly && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate({ body: text, picked: mentions });
          }}
        >
          <MentionTextarea
            rows={3}
            maxLength={5000}
            aria-label="새 댓글"
            placeholder="댓글을 입력하세요 (@ 로 멤버를 멘션)"
            value={text}
            onChange={setText}
            mentions={mentions}
            onMentionsChange={setMentions}
            members={members}
            meId={user.id}
          />
          <div className="row">
            <button type="submit" disabled={add.isPending || !text.trim()}>
              {add.isPending ? '등록 중…' : '댓글 등록'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
