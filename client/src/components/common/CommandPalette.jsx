import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listProjects } from '../../api/projects.js';
import { search } from '../../api/search.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useDebounced } from '../../hooks/useDebounced.js';
import { STATUS_LABELS } from '../../constants/task.js';
import { groupItems, moveIndex, projectIdFromPath, rankItems } from '../../utils/palette.js';

const MAX_PROJECTS = 6;

// Ctrl+K(Mac 은 ⌘K)로 여는 명령 팔레트: 페이지 이동, 현재 프로젝트의 작업 만들기·보기 전환,
// 프로젝트로 바로 가기, 통합검색 결과(작업·댓글·채팅)로 바로 가기를 키보드만으로 한다.
export default function CommandPalette({ open, onClose }) {
  const ref = useRef(null);
  const listRef = useRef(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query.trim());
  const searching = debounced.length >= 2;
  const projectId = projectIdFromPath(pathname);

  // 열려 있을 때만 렌더링되므로(부모가 마운트/언마운트로 제어) 열 때마다 입력과 선택이 초기화된다.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const projects = useQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: () => listProjects({ status: 'active', limit: 100 }),
    enabled: open,
  });
  const found = useQuery({
    queryKey: ['palette-search', debounced],
    queryFn: () => search(debounced, { limit: 5 }),
    enabled: open && searching,
  });

  const items = useMemo(() => {
    const go = (to) => () => navigate(to);
    const nav = [
      { id: 'nav-projects', label: '프로젝트 목록', keywords: ['projects', 'home'], run: go('/') },
      { id: 'nav-feed', label: '모아보기', keywords: ['feed'], run: go('/feed') },
      { id: 'nav-dashboard', label: '대시보드', keywords: ['dashboard'], run: go('/dashboard') },
      { id: 'nav-mine', label: '내 작업', keywords: ['tasks', 'mine'], run: go('/tasks/mine') },
      ...(user.role === 'admin'
        ? [
            {
              id: 'nav-admin',
              label: '사용자 관리',
              keywords: ['admin', 'users'],
              run: go('/admin/users'),
            },
          ]
        : []),
    ].map((i) => ({ ...i, group: '이동' }));

    const here = projectId
      ? [
          {
            id: 'here-new-task',
            label: '이 프로젝트에 작업 만들기',
            keywords: ['new', 'task', '추가'],
            run: go(`/projects/${projectId}?new=task`),
          },
          ...[
            ['board', '보드'],
            ['list', '목록'],
            ['calendar', '캘린더'],
            ['timeline', '타임라인'],
          ].map(([view, name]) => ({
            id: `here-view-${view}`,
            label: `작업 보기: ${name}`,
            keywords: [view, '보기', 'view'],
            run: go(`/projects/${projectId}?view=${view}`),
          })),
        ].map((i) => ({ ...i, group: '이 프로젝트' }))
      : [];

    const jump = rankItems(
      (projects.data?.data ?? []).map((p) => ({
        id: `project-${p.id}`,
        group: '프로젝트',
        label: p.name,
        run: go(`/projects/${p.id}`),
      })),
      query,
    ).slice(0, query.trim() ? MAX_PROJECTS : 4);

    const results = [];
    if (searching && found.data) {
      const taskLink = (pid, tid) => `/projects/${pid}?task=${tid}`;
      for (const t of found.data.tasks) {
        results.push({
          id: `task-${t.id}`,
          group: '작업',
          label: t.title,
          hint: `${t.projectName} · ${STATUS_LABELS[t.status] ?? t.status}`,
          run: go(taskLink(t.projectId, t.id)),
        });
      }
      for (const c of found.data.comments) {
        results.push({
          id: `comment-${c.id}`,
          group: '댓글',
          label: c.snippet ?? c.taskTitle,
          hint: `${c.projectName} · ${c.taskTitle}`,
          run: go(taskLink(c.projectId, c.taskId)),
        });
      }
      for (const m of found.data.chat) {
        results.push({
          id: `chat-${m.id}`,
          group: '채팅',
          label: m.snippet ?? m.body,
          hint: m.projectName,
          run: go(`/projects/${m.projectId}`),
        });
      }
    }
    const all = query.trim()
      ? [
          {
            id: 'search-all',
            group: '검색',
            label: `“${query.trim()}” 통합검색 결과 전체 보기`,
            run: go(`/search?q=${encodeURIComponent(query.trim())}`),
          },
        ]
      : [];

    return [...rankItems(here, query), ...rankItems(nav, query), ...jump, ...results, ...all];
  }, [navigate, user.role, projectId, projects.data, found.data, searching, query]);

  const groups = groupItems(items);
  const current = Math.min(active, Math.max(items.length - 1, 0));

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [current, items.length]);

  const run = (item) => {
    onClose();
    item.run();
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return; // 한글 조합 중의 Enter·화살표는 입력 확정용이다
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(moveIndex(current, e.key === 'ArrowDown' ? 1 : -1, items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[current]) run(items[current]);
    }
  };

  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label="명령 팔레트"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // 배경(backdrop) 클릭
      }}
    >
      <div className="palette-body">
        <input
          type="text"
          role="combobox"
          aria-label="명령 검색"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[current] ? `palette-opt-${current}` : undefined}
          placeholder="이동할 곳이나 실행할 명령, 검색어를 입력하세요"
          autoFocus
          autoComplete="off"
          maxLength={50}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div id="palette-list" role="listbox" aria-label="명령 목록" ref={listRef}>
          {groups.map(({ group, items: entries }) => (
            <div key={group} role="group" aria-label={group} className="palette-group">
              <div className="palette-group-title" aria-hidden="true">
                {group}
              </div>
              {entries.map(({ item, index }) => (
                <div
                  key={item.id}
                  id={`palette-opt-${index}`}
                  role="option"
                  aria-selected={index === current}
                  className={index === current ? 'palette-item on' : 'palette-item'}
                  onMouseMove={() => index !== current && setActive(index)}
                  onClick={() => run(item)}
                >
                  <span className="palette-label">{item.label}</span>
                  {item.hint && <span className="muted small palette-hint">{item.hint}</span>}
                </div>
              ))}
            </div>
          ))}
          {items.length === 0 && <p className="muted small palette-empty">맞는 항목이 없습니다.</p>}
          {searching && found.isFetching && (
            <p className="muted small palette-empty" role="status">
              검색 중…
            </p>
          )}
        </div>
        <p className="muted small palette-help">
          ↑↓ 이동 · Enter 실행 · Esc 닫기 · 2자 이상 입력하면 작업·댓글·채팅도 찾습니다
        </p>
      </div>
    </dialog>
  );
}
