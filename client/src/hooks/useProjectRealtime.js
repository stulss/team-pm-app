import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectSocket } from '../socket/index.js';

// 프로젝트 화면에서 실시간 이벤트를 구독해 React Query 캐시를 갱신한다.
// 원칙: 서버가 알려주면 해당 쿼리를 다시 가져온다(invalidate). 재연결 때도 전부 다시 가져와 유실된 이벤트를 보정한다.
// 반환값 offline: 연결이 2초 넘게 끊겨 있으면 true (연결 직후의 짧은 공백에는 안내를 띄우지 않기 위함).
export function useProjectRealtime(projectId) {
  const queryClient = useQueryClient();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!projectId) return undefined;
    const socket = connectSocket();

    const refetchActivities = () =>
      queryClient.invalidateQueries({ queryKey: ['activities', projectId] });
    const refetchChat = () => queryClient.invalidateQueries({ queryKey: ['chat', projectId] });
    const refetchTasks = () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
      queryClient.invalidateQueries({ queryKey: ['mytasks'] });
    };
    const refetchProject = () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    };
    const refetchComments = (payload) => {
      if (payload?.taskId) {
        queryClient.invalidateQueries({ queryKey: ['comments', payload.taskId] });
      }
      refetchTasks(); // 댓글 수 배지
    };

    let timer = null;
    const markOffline = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setOffline(true), 2000);
    };

    const join = () => socket.emit('project:join', { projectId });
    const onConnect = () => {
      clearTimeout(timer);
      setOffline(false);
      join();
      refetchTasks();
      refetchProject();
      queryClient.invalidateQueries({ queryKey: ['comments'] });
      refetchActivities();
      refetchChat();
    };
    const onDisconnect = markOffline;

    const handlers = {
      'task:created': refetchTasks,
      'task:updated': refetchTasks,
      'task:moved': refetchTasks,
      'task:deleted': refetchTasks,
      'comment:created': refetchComments,
      'comment:updated': refetchComments,
      'comment:deleted': refetchComments,
      'member:added': refetchProject,
      'member:removed': refetchProject,
      'project:updated': refetchProject,
      'project:deleted': refetchProject,
      'activity:created': refetchActivities,
      'chat:created': refetchChat,
      'chat:deleted': refetchChat,
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
    if (socket.connected) join();
    else markOffline();

    return () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
      if (socket.connected) socket.emit('project:leave', { projectId });
    };
  }, [projectId, queryClient]);

  return { offline };
}
