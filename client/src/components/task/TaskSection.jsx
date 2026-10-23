import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  bulkDeleteTasks,
  bulkUpdateTasks,
  getTask,
  listProjectTasks,
  updateTask,
} from '../../api/tasks.js';
import { errorMessage } from '../../api/http.js';
import { useDebounced } from '../../hooks/useDebounced.js';
import { useAuth } from '../../context/AuthContext.jsx';
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
import TimelineView from './TimelineView.jsx';
import { openBlockers } from '../../utils/timeline.js';
import SavedFilters from './SavedFilters.jsx';
import TaskBoard from './TaskBoard.jsx';
import BulkBar from './BulkBar.jsx';
import TaskModal from './TaskModal.jsx';

const VIEWS = ['board', 'list', 'calendar', 'timeline'];
const VIEW_KEY = 'team-pm:task-view';
// 같은 탭에서 마지막으로 고른 보기(새로고침해도 유지). 없으면 내 설정의 기본 작업 보기.
const readView = (fallback) => {
  try {
    const saved = sessionStorage.getItem(VIEW_KEY);
    return VIEWS.includes(saved) ? saved : fallback;
  } catch {
    return fallback; // 저장소를 쓸 수 없어도 동작해야 한다
  }
};

// 프로젝트 상세의 작업 섹션: 필터 + 보드/목록 뷰 + 생성/수정 모달.
export default function TaskSection({ project, archived }) {
  // 처음 보이는 보기는 내 설정(기본 작업 보기)이고, 탭을 누르면 이 탭에서는 그 선택이 유지된다.
  const { user } = useAuth();
  const [savedView, setView] = useState(() => readView(user.preferences.defaultView));
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
  // 명령 팔레트가 ?view=<보기>, ?new=task 로 보기 전환·작업 만들기를 요청할 수 있다.
  const viewParam = searchParams.get('view');
  const view = VIEWS.includes(viewParam) ? viewParam : savedView;
  const creating = searchParams.get('new') === 'task' && !archived;
  const dropParams = (...names) => {
    const next = new URLSearchParams(searchParams);
    for (const name of names) next.delete(name);
    setSearchParams(next, { replace: true });
  };
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
    if (viewParam) dropParams('view');
    try {
      sessionStorage.setItem(VIEW_KEY, next);
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
              ['timeline', '타임라인'],
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
      ) : view === 'timeline' ? (
        <TimelineView
          project={project}
          params={{ ...common, status: filters.status || undefined }}
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
          members={activeMembers}
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
      {linked.data && !modal && !creating && (
        <TaskModal
          projectId={project.id}
          ownerId={project.ownerId}
          members={project.members}
          task={linked.data}
          readOnly={archived}
          onClose={closeLinked}
        />
      )}
      {(modal || creating) && (
        <TaskModal
          projectId={project.id}
          ownerId={project.ownerId}
          members={project.members}
          task={modal?.task}
          readOnly={archived}
          onClose={() => {
            setModal(null);
            if (creating) dropParams('new');
          }}
        />
      )}
    </div>
  );
}

function TaskList({ project, archived, members, params, filtered, onOpenTask }) {
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

  // 일괄 선택(M39): 보이지 않게 된 작업(필터·삭제·다른 사용자의 변경)은 선택에서 뺀다.
  const [selected, setSelected] = useState(() => new Set());
  const [notice, setNotice] = useState('');
  const rows = data?.data ?? [];
  const selectedIds = rows.filter((t) => selected.has(t.id)).map((t) => t.id);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const headerBox = useRef(null);
  useEffect(() => {
    if (headerBox.current) {
      headerBox.current.indeterminate = selectedIds.length > 0 && !allSelected;
    }
  });
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((t) => t.id)));
  const done = (message) => {
    setSelected(new Set());
    setNotice(message);
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };
  const bulkUpdate = useMutation({
    mutationFn: (patch) => bulkUpdateTasks(project.id, selectedIds, patch),
    onSuccess: (res) => done(`${res.updated}개 작업을 바꿨습니다.`),
  });
  const bulkDelete = useMutation({
    mutationFn: () => bulkDeleteTasks(project.id, selectedIds),
    onSuccess: (res) => done(`${res.deleted}개 작업을 삭제했습니다.`),
  });
  const bulkBusy = bulkUpdate.isPending || bulkDelete.isPending;
  const bulkError = [bulkUpdate, bulkDelete].find((m) => m.isError)?.error;
  const applyBulk = async (patch) => {
    setNotice('');
    bulkDelete.reset();
    try {
      await bulkUpdate.mutateAsync(patch);
      return true;
    } catch {
      return false; // 오류는 아래에 표시한다
    }
  };
  const removeBulk = () => {
    if (!window.confirm(`선택한 ${selectedIds.length}개 작업을 삭제할까요? 되돌릴 수 없습니다.`)) {
      return;
    }
    setNotice('');
    bulkUpdate.reset();
    bulkDelete.mutate();
  };

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
        <div className="empty-state">
          <strong>
            {filtered
              ? '조건에 맞는 작업이 없습니다'
              : archived
                ? '작업이 없습니다'
                : '아직 작업이 없습니다'}
          </strong>
          {!filtered && !archived && <p>오른쪽 위의 “작업 추가”로 첫 작업을 만들어 보세요.</p>}
        </div>
      )}

      {notice && (
        <p role="status" className="save-state">
          {notice}
        </p>
      )}
      {bulkError && (
        <p role="alert" className="error">
          {errorMessage(bulkError, '일괄 처리하지 못했습니다.')}
        </p>
      )}
      {!archived && selectedIds.length > 0 && (
        <BulkBar
          count={selectedIds.length}
          members={members}
          busy={bulkBusy}
          onApply={applyBulk}
          onDelete={removeBulk}
          onClear={() => setSelected(new Set())}
        />
      )}

      {data && data.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {!archived && (
                  <th className="select-col">
                    <input
                      ref={headerBox}
                      type="checkbox"
                      aria-label="보이는 작업 모두 선택"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th>제목</th>
                <th>상태</th>
                <th>우선순위</th>
                <th>담당자</th>
                <th>마감일</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((t) => (
                <tr key={t.id} className={selected.has(t.id) ? 'selected' : undefined}>
                  {!archived && (
                    <td className="select-col">
                      <input
                        type="checkbox"
                        aria-label={`${t.title} 선택`}
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                      />
                    </td>
                  )}
                  <td className="wrap">
                    {t.key && <span className="task-key inline">{t.key} </span>}
                    <button type="button" className="linklike title" onClick={() => onOpenTask(t)}>
                      {t.title}
                    </button>
                    {t.commentCount > 0 && (
                      <span className="muted small"> 댓글 {t.commentCount}</span>
                    )}
                    {openBlockers(t).length > 0 && (
                      <span className="blocked-badge"> ⛔ 선행 {openBlockers(t).length}</span>
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
