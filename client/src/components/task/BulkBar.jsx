import { useState } from 'react';
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from '../../constants/task.js';

const EMPTY = { status: '', priority: '', assignee: '', dueDate: '', clearDue: false };

// 목록에서 고른 작업들에 한꺼번에 적용하는 줄. 비워 둔 항목은 바꾸지 않는다.
export default function BulkBar({ count, members, busy, onApply, onDelete, onClear }) {
  const [form, setForm] = useState(EMPTY);
  const set = (key) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));

  const patch = {};
  if (form.status) patch.status = form.status;
  if (form.priority) patch.priority = form.priority;
  if (form.assignee) patch.assigneeId = form.assignee === 'none' ? null : form.assignee;
  if (form.clearDue) patch.dueDate = null;
  else if (form.dueDate) patch.dueDate = form.dueDate;
  const hasChange = Object.keys(patch).length > 0;

  const apply = async (e) => {
    e.preventDefault();
    if (!hasChange) return;
    if (await onApply(patch)) setForm(EMPTY);
  };

  return (
    <form className="bulk-bar" aria-label="일괄 작업" onSubmit={apply}>
      <strong className="bulk-count">{count}개 선택</strong>
      <label className="bulk-field">
        <select value={form.status} onChange={set('status')} aria-label="상태 일괄 변경">
          <option value="">상태: 그대로</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="bulk-field">
        <select value={form.priority} onChange={set('priority')} aria-label="우선순위 일괄 변경">
          <option value="">우선순위: 그대로</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="bulk-field">
        <select value={form.assignee} onChange={set('assignee')} aria-label="담당자 일괄 변경">
          <option value="">담당자: 그대로</option>
          <option value="none">미배정으로</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="bulk-field bulk-due">
        <input
          type="date"
          value={form.dueDate}
          disabled={form.clearDue}
          onChange={set('dueDate')}
          aria-label="마감일 일괄 변경"
        />
      </label>
      <label className="inline small">
        <input type="checkbox" checked={form.clearDue} onChange={set('clearDue')} /> 마감일 지우기
      </label>
      <button type="submit" disabled={!hasChange || busy}>
        {busy ? '적용 중…' : '적용'}
      </button>
      <button type="button" className="danger" disabled={busy} onClick={onDelete}>
        선택 삭제
      </button>
      <button type="button" className="secondary" disabled={busy} onClick={onClear}>
        선택 해제
      </button>
    </form>
  );
}
