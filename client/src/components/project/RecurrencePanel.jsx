import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRecurrence,
  deleteRecurrence,
  listRecurrences,
  updateRecurrence,
} from '../../api/recurrences.js';
import { errorMessage } from '../../api/http.js';
import { PRIORITIES, PRIORITY_LABELS } from '../../constants/task.js';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const EMPTY = {
  title: '',
  frequency: 'weekly',
  weekday: '1',
  monthDay: '1',
  dueAfterDays: '',
  assigneeId: '',
  priority: 'medium',
};

const describe = (r) => {
  if (r.frequency === 'daily') return '매일';
  if (r.frequency === 'weekly') return `매주 ${WEEKDAYS[r.weekday]}요일`;
  return `매달 ${r.monthDay}일`;
};

// 반복 작업: 정해 둔 주기마다 작업 카드를 자동으로 만든다. 멤버는 보기만, 소유자·Admin 이 관리한다.
export default function RecurrencePanel({ project, canManage, archived }) {
  const queryClient = useQueryClient();
  const key = ['recurrences', project.id];
  const [form, setForm] = useState(EMPTY);
  const { data } = useQuery({ queryKey: key, queryFn: () => listRecurrences(project.id) });
  const rules = data?.data ?? [];
  const members = project.members.filter((m) => m.isActive);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (body) => createRecurrence(project.id, body),
    onSuccess: () => {
      setForm(EMPTY);
      refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }) => updateRecurrence(project.id, id, { active }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id) => deleteRecurrence(project.id, id),
    onSuccess: refresh,
  });
  const error = [create, toggle, remove].find((m) => m.isError)?.error;

  if (!canManage && rules.length === 0) return null;

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    create.mutate({
      title: form.title,
      frequency: form.frequency,
      priority: form.priority,
      ...(form.frequency === 'weekly' && { weekday: Number(form.weekday) }),
      ...(form.frequency === 'monthly' && { monthDay: Number(form.monthDay) }),
      ...(form.dueAfterDays !== '' && { dueAfterDays: Number(form.dueAfterDays) }),
      ...(form.assigneeId && { assigneeId: form.assigneeId }),
    });
  };

  return (
    <section className="card recurrences" aria-label="반복 작업">
      <h2>반복 작업</h2>
      <p className="muted small">
        정해 둔 주기가 되면 하루 한 번 작업 카드를 자동으로 만듭니다(매일 아침 한국 시간 기준).
      </p>
      {error && (
        <p role="alert" className="error">
          {errorMessage(error, '요청에 실패했습니다.')}
        </p>
      )}

      {rules.length > 0 && (
        <ul className="recurrence-list">
          {rules.map((r) => (
            <li key={r.id} className={r.active ? undefined : 'off'}>
              <span className="recurrence-info">
                <strong>{r.title}</strong>
                <span className="muted small">
                  {describe(r)} · {PRIORITY_LABELS[r.priority]}
                  {r.dueAfterDays !== null && ` · 마감 ${r.dueAfterDays}일 뒤`}
                  {r.active ? ` · 다음 ${r.nextRunDate}` : ' · 꺼짐'}
                </span>
              </span>
              {canManage && (
                <>
                  <button
                    type="button"
                    className="secondary"
                    disabled={toggle.isPending || archived}
                    onClick={() => toggle.mutate({ id: r.id, active: !r.active })}
                  >
                    {r.active ? '끄기' : '켜기'}
                  </button>
                  <button
                    type="button"
                    className="danger-ghost"
                    aria-label={`${r.title} 삭제`}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `"${r.title}" 반복 작업을 삭제할까요? 이미 만든 카드는 남습니다.`,
                        )
                      )
                        remove.mutate(r.id);
                    }}
                  >
                    삭제
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && !archived && (
        <form className="recurrence-form" onSubmit={submit} aria-label="반복 작업 추가">
          <input
            aria-label="반복 작업 제목"
            placeholder="예: 주간 회의록 정리"
            maxLength={200}
            required
            value={form.title}
            onChange={set('title')}
          />
          <div className="row">
            <select aria-label="반복 주기" value={form.frequency} onChange={set('frequency')}>
              <option value="daily">매일</option>
              <option value="weekly">매주</option>
              <option value="monthly">매달</option>
            </select>
            {form.frequency === 'weekly' && (
              <select aria-label="반복 요일" value={form.weekday} onChange={set('weekday')}>
                {WEEKDAYS.map((w, i) => (
                  <option key={w} value={i}>
                    {w}요일
                  </option>
                ))}
              </select>
            )}
            {form.frequency === 'monthly' && (
              <select aria-label="반복 날짜" value={form.monthDay} onChange={set('monthDay')}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}일
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="반복 작업 우선순위"
              value={form.priority}
              onChange={set('priority')}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <select
              aria-label="반복 작업 담당자"
              value={form.assigneeId}
              onChange={set('assigneeId')}
            >
              <option value="">담당자 없음</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={60}
              aria-label="마감까지 일수"
              placeholder="마감까지 며칠(선택)"
              value={form.dueAfterDays}
              onChange={set('dueAfterDays')}
            />
            <button type="submit" disabled={create.isPending}>
              {create.isPending ? '추가 중…' : '규칙 추가'}
            </button>
          </div>
          {form.frequency === 'monthly' && Number(form.monthDay) > 28 && (
            <p className="muted small">날짜가 없는 달에는 그 달 마지막 날에 만듭니다.</p>
          )}
        </form>
      )}
    </section>
  );
}
