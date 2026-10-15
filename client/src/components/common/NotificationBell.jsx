import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications.js';

const formatTime = (iso) =>
  new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

// 상단바의 알림 벨: 안 읽은 개수 배지 + 최근 알림 목록. 새 알림은 실시간(notification:new)으로
// ['notifications'] 쿼리를 갱신해 반영된다(useUserRealtime).
export default function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  const { data: count = 0 } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: getUnreadCount,
  });
  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => listNotifications({ limit: 20 }),
    enabled: open,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh });

  // 바깥 클릭 / Esc 로 닫기
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (root.current && !root.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openNotification = (n) => {
    if (!n.isRead) read.mutate(n.id);
    setOpen(false);
    navigate(`/projects/${n.projectId}?task=${n.taskId}`);
  };

  return (
    <div className="bell" ref={root}>
      <button
        type="button"
        className="secondary bell-button"
        aria-label={count > 0 ? `알림 (안 읽음 ${count}개)` : '알림'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        알림
        {count > 0 && (
          <span className="bell-badge" data-testid="unread-count">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="알림 목록">
          <div className="row between">
            <strong>알림</strong>
            <button
              type="button"
              className="linklike small"
              disabled={count === 0 || readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              모두 읽음
            </button>
          </div>
          {list.isPending && <p className="muted small">불러오는 중…</p>}
          {list.isError && (
            <p role="alert" className="error small">
              알림을 불러오지 못했습니다.
            </p>
          )}
          {list.data?.data.length === 0 && <p className="muted small">알림이 없습니다.</p>}
          <ul className="bell-list">
            {list.data?.data.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={n.isRead ? 'bell-item' : 'bell-item unread'}
                  onClick={() => openNotification(n)}
                >
                  <span>{n.message}</span>
                  <span className="muted small">{formatTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
