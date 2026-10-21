// 저장된 필터를 화면 상태({ filters, q })로 바꾼다. 지워진 라벨·멤버를 가리키는 값은 버려서
// "결과 없음" 이 되지 않게 한다. labelIds·memberIds 는 Set.
export function applySaved(saved, { labelIds, memberIds }) {
  const f = saved.filters ?? {};
  const assigneeOk =
    f.assignee === 'me' || f.assignee === 'unassigned' || memberIds.has(f.assignee);
  return {
    filters: {
      status: f.status ?? '',
      priority: f.priority ?? '',
      assignee: assigneeOk ? f.assignee : '',
      label: labelIds.has(f.label) ? f.label : '',
    },
    q: f.q ?? '',
  };
}

// 현재 필터 조합에서 값이 있는 것만 저장 형식으로 만든다.
export function currentFilters(filters, q) {
  const out = {};
  for (const key of ['status', 'priority', 'assignee', 'label']) {
    if (filters[key]) out[key] = filters[key];
  }
  if (q.trim()) out.q = q.trim();
  return out;
}
