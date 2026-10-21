// 라벨 하나를 색 점 + 이름으로 보여 준다. 색만으로 구분하지 않도록 이름을 항상 함께 쓴다.
export default function LabelChip({ label }) {
  return (
    <span className={`label-chip lc-${label.color}`} data-label-id={label.id}>
      {label.name}
    </span>
  );
}
