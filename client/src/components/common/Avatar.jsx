// 이름의 첫 글자를 보여 주는 동그란(또는 둥근 사각) 표시. 색은 이름에서 정해 같은 사람은 항상 같은 색이다.
// 글자는 CSS(content: attr(data-initial))로 그려서 문서 텍스트·접근성 이름에 섞이지 않는다.
// 이름은 항상 옆에 글자로 있으므로 장식으로 취급한다(aria-hidden).
export const hueOf = (name = '') => {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
};

export default function Avatar({ name, size = 'md', shape = 'round', className = '' }) {
  const initial =
    String(name ?? '?')
      .trim()
      .slice(0, 1)
      .toUpperCase() || '?';
  return (
    <span
      className={`avatar avatar-${size} avatar-${shape} ${className}`.trim()}
      style={{ '--av-h': hueOf(name) }}
      data-initial={initial}
      aria-hidden="true"
    />
  );
}
