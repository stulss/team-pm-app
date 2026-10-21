import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { getTask, listProjectTasks, updateTask } from '../../api/tasks.js';
import { errorMessage } from '../../api/http.js';
import { useDebounced } from '../../hooks/useDebounced.js';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  isOverdue,
} from '../../constants/task.js';
import { checklistText } from '../../constants/labels.js';
import { listLabels } from '../../api/labels.js';
import LabelChip from './LabelChip.jsx';
import LabelManager from './LabelManager.jsx';
import CalendarView from './CalendarView.jsx';
import SavedFilters from './SavedFilters.jsx';
import TaskBoard from './TaskBoard.jsx';
import TaskModal from './TaskModal.jsx';

const VIEW_KEY = 'team-pm:task-view';
const readView = () => {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return ['list', 'calendar'].includes(saved) ? saved : 'board';
  } catch {
    return 'board'; // 저장소를 쓸 수 없어도 동작해야 한다
  }
};

// 프로젝트 상세의 작업 섹션: 필터 + 보드/목록 뷰 + 생성/수정 모달.
export default function TaskSection({ project, archived }) {
  const [view, setView] = useState(readView);
  const [filters, setFilters] = useState({ status: '', priority: '', assignee: '', label: '' });
  const [managingLabels, setManagingLabels] = useState(false);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // null | { task? }
  const debouncedQ = useDebounced(q.trim());
  const labels = useQuery({
    queryKey: ['labels', project.id],
    queryFn: () => listLabels(project.id),
  });

  // 알림 링크(?task=<id>)로 들어오면 해당 작업을 연다.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedId = searchParams.get('task');
  const linked = useQuery({
    queryKey: ['task', linkedId],
    queryFn: () => getTask(linkedId),
    enabled: Boolean(linkedId),
    retry: false,
  });
  const closeLinked = () => setSearchParams({}, { replace: true });

  const changeView = (next) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* 저장 실패는 무시 */
    }
  };

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const filtered = Boolean(
    filters.status || filters.priority || filters.assignee || filters.label || debouncedQ,
  );
  const activeMembers = project.members.filter((m) => m.isActive);
  const common = {
    priority: filters.priority || undefined,
    assignee: filters.assignee || undefined,
    label: filters.label || undefined,
    q: debouncedQ || undefined,
  };

  return (
    <div className="card">
      <div className="row between">
        <div className="row">
          <h2>작업</h2>
          <div className="tabs" role="tablist" aria-label="보기 방식">
            {[
              ['board', '보드'],
              ['list', '목록'],
              ['calendar', '캘린더'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                className={view === value ? 'tab active' : 'tab'}
                onClick={() => changeView(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {!archived && (
          <button type="button" onClick={() => setModal({})}>
            작업 추가
          </button>
        )}
      </div>

      <div className="filters">
        <input
          type="search"
          aria-label="작업 검색"
          placeholder="제목·설명 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {view !== 'board' && (
          <select aria-label="상태 필터" value={filters.status} onChange={setFilter('status')}>
            <option value="">상태 전체</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="우선순위 필터"
          value={filters.priority}
          onChange={setFilter('priority')}
        >
          <option value="">우선순위 전체</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select aria-label="담당자 필터" value={filters.assignee} onChange={setFilter('assignee')}>
          <option value="">담당자 전체</option>
          <option value="me">나</option>
          <option value="unassigned">미배정</option>
          {activeMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select aria-label="라벨 필터" value={filters.label} onChange={setFilter('label')}>
          <option value="">라벨 전체</option>
          {(labels.data?.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={() => setManagingLabels(true)}>
          라벨 관리
        </button>
        {filtered && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setFilters({ status: '', priority: '', assignee: '', label: '' });
              setQ('');
            }}
          >
            필터 초기화
          </button>
        )}
      </div>

      <SavedFilters
        projectId={project.id}
        filters={filters}
        q={q}
        labelIds={new Set((labels.data?.data ?? []).map((l) => l.id))}
        memberIds={new Set(activeMembers.map((m) => m.id))}
        onApply={({ filters: next, q: nextQ }) => {
          setFilters(next);
          setQ(nextQ);
        }}
      />

      {view === 'board' ? (
        <TaskBoard
          project={project}
          archived={archived}
          filters={common}
          onOpenTask={(task) => setModal({ task })}
        />
      ) : view === 'calendar' ? (
        <CalendarView
          project={project}
          params={{ ...common, status: filters.status || undefined }}
          onOpenTask={(task) => setModal({ task })}
        />
      ) : (
        <TaskList
          project={project}
          archived={archived}
          params={{ ...common, status: filters.status || undefined, limit: 200 }}
          filtered={filtered}
          onOpenTask={(task) => setModal({ task })}
        />
      )}

      {managingLabels && (
        <LabelManager
          project={project}
          archived={archived}
          onClose={() => setManagingLabels(false)}
        />
      )}
      {linked.data && !modal && (
        <TaskModal
          projectId={project.id}
          ownerId={project.ownerId}
          members={project.members}
          task={linked.data}
          readOnly={archived}
          onClose={closeLinked}
        />
      )}
      {modal && (
        <TaskModal
          projectId={project.id}
          ownerId={project.ownerId}
          members={project.members}
          task={modal.task}
          readOnly={archived}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function TaskList({ project, archived, params, filtered, onOpenTask }) {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['tasks', project.id, 'list', params],
    queryFn: () => listProjectTasks(project.id, params),
    placeholderData: (prev) => prev,
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, status }) => updateTask(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  return (
    <>
      {isPending && <p className="muted">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '작업을 불러오지 못했습니다.')}
        </p>
      )}
      {changeStatus.isError && (
        <p role="alert" className="error">
          {errorMessage(changeStatus.error)}
        </p>
      )}

      {data && data.data.length === 0 && (
        <p className="muted">
          {filtered
            ? '조건에 맞는 작업이 없습니다.'
            : archived
              ? '작업이 없습니다.'
              : '아직 작업이 없습니다. 작업을 추가해 보세요.'}
        </p>
      )}

      {data && data.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>제목</th>
                <th>상태</th>
                <th>우선순위</th>
                <th>담당자</th>
                <th>마감일</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((t) => (
                <tr key={t.id}>
                  <td className="wrap">
                    <button type="button" className="linklike title" onClick={() => onOpenTask(t)}>
                      {t.title}
                    </button>
                    {t.commentCount > 0 && (
                      <span className="muted small"> 댓글 {t.commentCount}</span>
                    )}
                    {checklistText(t.checklist) && (
                      <span className="checklist-badge"> ✓ {checklistText(t.checklist)}</span>
                    )}
                    {t.labels?.length > 0 && (
                      <div className="task-card-labels">
                        {t.labels.map((l) => (
                          <LabelChip key={l.id} label={l} />
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <select
                      aria-label={`${t.title} 상태`}
                      value={t.status}
                      disabled={archived || changeStatus.isPending}
                      onChange={(e) => changeStatus.mutate({ id: t.id, status: e.target.value })}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`badge badge-p-${t.priority}`}>
                      {PRIORITY_LABELS[t.priority]}
                    </span>
                  </td>
                  <td>{t.assignee?.name ?? <span className="muted">미배정</span>}</td>
                  <td className={isOverdue(t) ? 'overdue' : ''}>
                    {t.dueDate ?? <span className="muted">-</span>}
                    {isOverdue(t) && ' (지연)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
