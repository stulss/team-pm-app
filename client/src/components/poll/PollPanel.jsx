import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { closePoll, createPoll, deletePoll, listPolls, votePoll } from '../../api/polls.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

const percent = (votes, total) => (total === 0 ? 0 : Math.round((votes / total) * 100));

function CreateForm({ projectId, onDone }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      createPoll(projectId, {
        question,
        options: options.map((o) => o.trim()).filter(Boolean),
        multiple,
      }),
    onSuccess: onDone,
  });
  const filled = options.filter((o) => o.trim()).length;
  const setOption = (i, value) => setOptions(options.map((o, j) => (j === i ? value : o)));

  return (
    <form
      className="stack poll-form"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <label>
        질문
        <input
          required
          maxLength={200}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      {options.map((o, i) => (
        <div className="row" key={i}>
          <input
            aria-label={`선택지 ${i + 1}`}
            maxLength={100}
            value={o}
            onChange={(e) => setOption(i, e.target.value)}
          />
          {options.length > MIN_OPTIONS && (
            <button
              type="button"
              className="linklike small"
              onClick={() => setOptions(options.filter((_, j) => j !== i))}
            >
              삭제
            </button>
          )}
        </div>
      ))}
      <div className="row">
        {options.length < MAX_OPTIONS && (
          <button type="button" className="secondary" onClick={() => setOptions([...options, ''])}>
            선택지 추가
          </button>
        )}
        <label className="inline">
          <input
            type="checkbox"
            checked={multiple}
            onChange={(e) => setMultiple(e.target.checked)}
          />{' '}
          복수 선택 허용
        </label>
      </div>
      {create.isError && (
        <p role="alert" className="error">
          {errorMessage(create.error)}
        </p>
      )}
      <div className="row">
        <button
          type="submit"
          disabled={create.isPending || !question.trim() || filled < MIN_OPTIONS}
        >
          투표 만들기
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          취소
        </button>
      </div>
    </form>
  );
}

function PollCard({ poll, project, archived, onChange }) {
  const { user } = useAuth();
  const canManage =
    !archived &&
    (poll.createdBy?.id === user.id || user.role === 'admin' || project.ownerId === user.id);
  const open = !poll.closed && !archived;

  const vote = useMutation({
    mutationFn: (optionIds) => votePoll(project.id, poll.id, optionIds),
    onSuccess: onChange,
  });
  const close = useMutation({
    mutationFn: () => closePoll(project.id, poll.id),
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: () => deletePoll(project.id, poll.id),
    onSuccess: onChange,
  });
  const error = [vote, close, remove].find((m) => m.isError)?.error;

  const pick = (optionId) => {
    if (!poll.multiple) return vote.mutate([optionId]);
    const next = poll.myVotes.includes(optionId)
      ? poll.myVotes.filter((id) => id !== optionId)
      : [...poll.myVotes, optionId];
    return vote.mutate(next);
  };

  return (
    <li className="poll" data-poll-id={poll.id}>
      <div className="poll-head">
        <strong>{poll.question}</strong>
        {poll.closed && <span className="badge badge-archived">마감</span>}
        {poll.multiple && <span className="muted small">복수 선택</span>}
        <span className="spacer" />
        {canManage && !poll.closed && (
          <button
            type="button"
            className="linklike small"
            disabled={close.isPending}
            onClick={() => {
              if (window.confirm('투표를 마감할까요? 마감하면 더 이상 투표할 수 없습니다.')) {
                close.mutate();
              }
            }}
          >
            마감
          </button>
        )}
        {canManage && (
          <button
            type="button"
            className="linklike small"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm('이 투표를 삭제할까요?')) remove.mutate();
            }}
          >
            삭제
          </button>
        )}
      </div>
      <ul className="poll-options">
        {poll.options.map((o) => {
          const mine = poll.myVotes.includes(o.id);
          const pct = percent(o.votes, poll.totalVoters);
          return (
            <li key={o.id} className={mine ? 'poll-option mine' : 'poll-option'}>
              <label>
                <input
                  type={poll.multiple ? 'checkbox' : 'radio'}
                  name={`poll-${poll.id}`}
                  checked={mine}
                  disabled={!open || vote.isPending}
                  onChange={() => pick(o.id)}
                />{' '}
                {o.label}
              </label>
              <span className="poll-count">
                {o.votes}표 ({pct}%)
              </span>
              <div className="poll-bar" aria-hidden="true">
                <div style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="row between muted small">
        <span>
          {poll.totalVoters}명 참여 · {poll.createdBy?.name ?? '알 수 없는 사용자'}
        </span>
        {open && poll.myVotes.length > 0 && (
          <button
            type="button"
            className="linklike small"
            disabled={vote.isPending}
            onClick={() => vote.mutate([])}
          >
            내 투표 취소
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {errorMessage(error)}
        </p>
      )}
    </li>
  );
}

// 프로젝트 투표. 익명 집계라 득표수만 보이고 누가 골랐는지는 보이지 않는다.
// 다른 사용자의 변경은 프로젝트 화면의 실시간 구독이 ['polls', projectId] 를 갱신해 반영된다.
export default function PollPanel({ project, archived = false }) {
  const queryClient = useQueryClient();
  const key = ['polls', project.id];
  const [creating, setCreating] = useState(false);
  const { data, isPending, isError, error } = useQuery({
    queryKey: key,
    queryFn: () => listPolls(project.id),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const polls = data?.data ?? [];

  return (
    <section className="polls" aria-label="투표">
      <div className="row between">
        <h2>투표</h2>
        {!archived && !creating && (
          <button type="button" className="secondary" onClick={() => setCreating(true)}>
            새 투표
          </button>
        )}
      </div>
      {creating && (
        <CreateForm
          projectId={project.id}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
      {isPending && <p className="muted small">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '투표를 불러오지 못했습니다.')}
        </p>
      )}
      {data && polls.length === 0 && !creating && (
        <p className="muted small">아직 투표가 없습니다.</p>
      )}
      <ul className="poll-list">
        {polls.map((p) => (
          <PollCard key={p.id} poll={p} project={project} archived={archived} onChange={refresh} />
        ))}
      </ul>
    </section>
  );
}
