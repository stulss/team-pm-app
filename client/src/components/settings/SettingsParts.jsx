// 선택지 하나가 라디오 버튼인 그룹. 고르면 바로 적용·저장된다.
export function ChoiceGroup({ label, name, options, value, onChange, render }) {
  return (
    <fieldset className="choice-group" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className="choice">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {render ? render(o) : o.label}
        </label>
      ))}
    </fieldset>
  );
}

export function Row({ title, hint, children }) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}
