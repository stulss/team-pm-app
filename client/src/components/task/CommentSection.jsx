import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createComment, deleteComment, listComments, updateComment } from '../../api/comments.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';

const formatTime = (iso) =>
  new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

// 작업 모달의 댓글 영역. 본문은 항상 텍스트로 렌더링한다(HTML 로 해석하지 않음).
// 다른 사용자의 변경은 프로젝트 화면의 실시간 구독이 ['comments', taskId] 를 갱신해 반영된다.
export default function CommentSection({ taskId, ownerId, readOnly = false }) {
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
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const add = useMutation({
    mutationFn: () => createComment(taskId, text),
    onSuccess: () => {
      setText('');
      refresh();
    },
  });
  const save = useMutation({
    mutationFn: ({ id, body }) => updateComment(id, body),
    onSuccess: () => {
      setEditingId(null);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id) => deleteComment(id), onSuccess: refresh });
  const mutationError = [add, save, remove].find((m) => m.isError)?.error;

  const comments = data?.data ?? [];
  const canDelete = (c) =>
    !readOnly &&
    !c.deleted &&
    (c.author.id === user.id ||
      user.role === 'admin' ||
      user.role === 'manager' ||
      ownerId === user.id);

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
        {comments.map((c) => (
          <li key={c.id} className="comment" data-comment-id={c.id}>
            <div className="comment-meta">
              <strong>{c.author.name}</strong>
              <span className="muted small">{formatTime(c.createdAt)}</span>
              {c.edited && <span className="muted small">(수정됨)</span>}
              <span className="spacer" />
              {!readOnly && !c.deleted && c.author.id === user.id && editingId !== c.id && (
                <button
                  type="button"
                  className="linklike small"
                  onClick={() => {
                    setEditingId(c.id);
                    setEditText(c.body);
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
                <textarea
                  rows={3}
                  maxLength={5000}
                  aria-label="댓글 수정"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
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
              <p className={c.deleted ? 'comment-body muted' : 'comment-body'}>{c.body}</p>
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
            if (text.trim()) add.mutate();
          }}
        >
          <textarea
            rows={3}
            maxLength={5000}
            aria-label="새 댓글"
            placeholder="댓글을 입력하세요"
            value={text}
            onChange={(e) => setText(e.target.value)}
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
