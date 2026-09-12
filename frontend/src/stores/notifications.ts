import { create } from 'zustand';
import { duelApi } from '../api/client';

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  data?: any;
  is_read: boolean;
  created_at: string;
  related_entity_type?: string;
  related_entity_id?: number;
}

interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  /** Загрузить непрочитанные уведомления с сервера (единственный источник правды). */
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  /** Отметить всё прочитанным одним запросом. */
  markAllAsRead: () => Promise<void>;
  /** Погасить уведомления по конкретной дуэли (когда игрок увидел результат). */
  markDuelAsRead: (duelId: number) => Promise<void>;
  clear: () => void;
}

const withUnreadCount = (notifications: Notification[]) => ({
  notifications,
  unreadCount: notifications.filter(n => !n.is_read).length
});

export const useNotifications = create<NotificationsState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,

  fetchNotifications: async () => {
    if (get().isLoading) return;
    set({ isLoading: true });
    try {
      const response = await duelApi.notifications();
      const notifications: Notification[] = response.notifications || [];
      set({ ...withUnreadCount(notifications), isLoading: false });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      set({ isLoading: false });
    }
  },

  markAsRead: async (id: number) => {
    try {
      await duelApi.markNotificationAsRead(id);
      const updated = get().notifications.map(n => (n.id === id ? { ...n, is_read: true } : n));
      set(withUnreadCount(updated));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  },

  markAllAsRead: async () => {
    try {
      await duelApi.markAllNotificationsAsRead();
      set(withUnreadCount(get().notifications.map(n => ({ ...n, is_read: true }))));
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  },

  markDuelAsRead: async (duelId: number) => {
    if (!Number.isFinite(duelId)) return;
    const matches = (n: Notification) => Number(n.data?.duel_id) === Number(duelId);
    // Сразу гасим локально, чтобы бейдж не мигал, и параллельно — на сервере:
    // там помечаются и те уведомления, которых ещё нет в локальном списке.
    const local = get().notifications.filter(n => !n.is_read && matches(n));
    if (local.length) {
      set(withUnreadCount(get().notifications.map(n => (matches(n) ? { ...n, is_read: true } : n))));
    }
    try {
      await duelApi.markDuelNotificationsAsRead(duelId);
    } catch (error) {
      console.error('Error marking duel notifications as read:', error);
      // Сервер не записал «прочитано» — пробуем ещё, иначе следующий опрос
      // вернёт уведомление, и окно, которое игрок уже закрыл, всплывёт снова.
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          await duelApi.markDuelNotificationsAsRead(duelId);
          break;
        } catch { /* попробуем ещё раз */ }
      }
    }
    await get().fetchNotifications();
  },

  clear: () => set({ notifications: [], unreadCount: 0 })
}));
