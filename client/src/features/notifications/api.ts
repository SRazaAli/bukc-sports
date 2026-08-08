import { api } from '../../lib/api.js';

export interface AppNotification {
  notificationId: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export const listNotifications = (limit = 20) =>
  api<{ notifications: AppNotification[] }>(`/api/notifications?limit=${limit}`);

export const unreadNotificationCount = () =>
  api<{ count: number }>('/api/notifications/unread-count');

export const markNotificationRead = (id: string) =>
  api<{ message: string }>(`/api/notifications/${id}/read`, { method: 'POST', body: {} });

export const markAllNotificationsRead = () =>
  api<{ message: string }>('/api/notifications/read-all', { method: 'POST', body: {} });
