import { useState } from 'react';
import { REACTIONS, reactionChips } from '../../constants/reactions.js';

// 이모지 반응 줄: 달린 반응(개수·내가 눌렀는지·누가 눌렀는지)과 반응 추가 버튼.
// 누르면 내 반응을 달거나 거둔다(onToggle(key, 달기 여부)). 보관된 프로젝트 등 읽기 전용이면 보기만 한다.
export default function ReactionBar({
  reactions,
  meId,
  readOnly = false,
  pending = false,
  onToggle,
}) {
  const [picking, setPicking] = useState(false);
  const chips = reactionChips(reactions, meId);
  const mineKeys = new Set(chips.filter((c) => c.mine).map((c) => c.key));
  if (readOnly && chips.length === 0) return null;

  return (
    <div className="reactions">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          className={c.mine ? 'reaction on' : 'reaction'}
          aria-pressed={c.mine}
          aria-label={`${c.label} ${c.count}명: ${c.names}`}
          title={c.names}
          disabled={readOnly || pending}
          onClick={() => onToggle(c.key, !c.mine)}
        >
          <span aria-hidden="true">{c.emoji}</span> {c.count}
        </button>
      ))}
      {!readOnly && (
        <span className="reaction-add">
          <button
            type="button"
            className="reaction"
            aria-label="반응 추가"
            aria-expanded={picking}
            onClick={() => setPicking((v) => !v)}
          >
            ＋
          </button>
          {picking && (
            <span className="reaction-picker" role="group" aria-label="반응 고르기">
              {REACTIONS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className="reaction"
                  aria-label={`${r.label} 반응`}
                  aria-pressed={mineKeys.has(r.key)}
                  disabled={pending}
                  onClick={() => {
                    onToggle(r.key, !mineKeys.has(r.key));
                    setPicking(false);
                  }}
                >
                  <span aria-hidden="true">{r.emoji}</span>
                </button>
              ))}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
