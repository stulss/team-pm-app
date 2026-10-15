import { http } from './http.js';

const data = (res) => res.data;

export const listNotifications = (params) => http.get('/notifications', { params }).then(data);
export const getUnreadCount = () =>
  http.get('/notifications/unread-count').then((res) => res.data.count);
export const markNotificationRead = (id) => http.patch(`/notifications/${id}/read`);
export const markAllNotificationsRead = () => http.post('/notifications/read-all').then(data);
