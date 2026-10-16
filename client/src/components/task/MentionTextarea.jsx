import { useMemo, useRef, useState } from 'react';

// 입력 중에 '@' 뒤로 글자를 치면 프로젝트 멤버 후보를 보여 주고, 고르면 `@이름 ` 을 넣는다.
// 고른 사람은 mentions({id, name}) 로 부모에게 알린다. 서버로 보낼 ID 는 부모가 본문에 이름이
// 남아 있는지 확인해 추린다(utils/mentions.js 의 activeMentionIds).
export default function MentionTextarea({
  value,
  onChange,
  mentions,
  onMentionsChange,
  members,
  meId,
  ...textareaProps
}) {
  const ref = useRef(null);
  const [trigger, setTrigger] = useState(null); // { start, query }
  const [active, setActive] = useState(0);

  const candidates = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    return members
      .filter((m) => m.id !== meId && m.isActive !== false && m.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [trigger, members, meId]);

  const detect = (text, caret) => {
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
    setTrigger(m ? { start: caret - m[2].length - 1, query: m[2] } : null);
    setActive(0);
  };

  const pick = (member) => {
    const caret = ref.current?.selectionStart ?? value.length;
    onChange(`${value.slice(0, trigger.start)}@${member.name} ${value.slice(caret)}`);
    if (!mentions.some((x) => x.id === member.id)) {
      onMentionsChange([...mentions, { id: member.id, name: member.name }]);
    }
    const position = trigger.start + member.name.length + 2;
    setTrigger(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (e) => {
    if (!trigger || candidates.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % candidates.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + candidates.length) % candidates.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(candidates[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // 모달이 같이 닫히지 않게
      setTrigger(null);
    }
  };

  return (
    <div className="mention-box">
      <textarea
        {...textareaProps}
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => detect(e.target.value, e.target.selectionStart)}
        onBlur={() => setTrigger(null)}
      />
      {trigger && candidates.length > 0 && (
        <ul className="mention-list" role="listbox" aria-label="멘션 후보">
          {candidates.map((m, i) => (
            <li
              key={m.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              // blur 로 목록이 닫히기 전에 선택되도록 mousedown 에서 처리한다
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
            >
              {m.name} <span className="muted small">{m.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
