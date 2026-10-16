import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectSocket } from '../socket/index.js';

// 프로젝트 화면 밖에서도 필요한 개인 이벤트: 프로젝트에 추가/제거되면 프로젝트 목록을, 새 알림이 오면 알림을 갱신한다.
export function useUserRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = connectSocket();
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['mytasks'] });
    };
    const refreshNotifications = () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    };
    socket.on('member:added', refresh);
    socket.on('member:removed', refresh);
    socket.on('notification:new', refreshNotifications);
    // 재연결 후에는 그동안 놓친 알림도 다시 가져온다.
    socket.on('connect', refreshNotifications);
    return () => {
      socket.off('member:added', refresh);
      socket.off('member:removed', refresh);
      socket.off('notification:new', refreshNotifications);
      socket.off('connect', refreshNotifications);
    };
  }, [queryClient]);
}
