import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectSocket } from '../socket/index.js';

// 프로젝트 화면 밖에서도 필요한 개인 이벤트: 프로젝트에 추가/제거되면 프로젝트 목록을 갱신한다.
export function useUserRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = connectSocket();
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['mytasks'] });
    };
    socket.on('member:added', refresh);
    socket.on('member:removed', refresh);
    return () => {
      socket.off('member:added', refresh);
      socket.off('member:removed', refresh);
    };
  }, [queryClient]);
}
