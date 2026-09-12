import { create } from 'zustand';
import { duelApi } from '../api/client';

interface Notification {
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
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  addNotification: (notification: Notification) => void;
}

export const useNotifications = create<NotificationsState>((set: any, get: any) => {
  return {
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    
    fetchNotifications: async () => {
      set({ isLoading: true });
      try {
        const response = await duelApi.notifications();
        const notifications: Notification[] = response.notifications || [];
        const unreadCount = notifications.filter((n: Notification) => !n.is_read).length;
        set({ notifications, unreadCount, isLoading: false });
      } catch (error) {
        set({ isLoading: false });
      }
    },
    
    markAsRead: async (id: number) => {
      try {
        await duelApi.markNotificationAsRead(id);
        const state = get();
        const notifications: Notification[] = state.notifications;
        const updated = notifications.map((n: Notification) => 
          n.id === id ? { ...n, is_read: true } : n
        );
        const unreadCount = updated.filter((n: Notification) => !n.is_read).length;
        set({ notifications: updated, unreadCount });
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    },
    
    markAllAsRead: async () => {
      const state = get();
      const notifications: Notification[] = state.notifications;
      const unreadIds = notifications.filter((n: Notification) => !n.is_read).map((n: Notification) => n.id);
      
      try {
        await Promise.all(unreadIds.map((id: number) => duelApi.markNotificationAsRead(id)));
        const updated = notifications.map((n: Notification) => ({ ...n, is_read: true }));
        set({ notifications: updated, unreadCount: 0 });
      } catch (error) {
        console.error('Error marking all notifications as read:', error);
      }
    },
    
    addNotification: (notification: Notification) => {
      const state = get();
      const notifications: Notification[] = state.notifications;
      const exists = notifications.some((n: Notification) => n.id === notification.id);
      if (!exists) {
        const updated = [notification, ...notifications];
        const currentUnread: number = state.unreadCount;
        const unreadCount = notification.is_read ? currentUnread : currentUnread + 1;
        set({ notifications: updated, unreadCount });
      }
    }
  };
});