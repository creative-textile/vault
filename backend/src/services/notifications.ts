/**
 * Уведомления.
 * В проде — отправка через Telegram Bot API sendMessage.
 * В демо — рассылаем через WebSocket как in-app уведомления.
 * Также сохраняем уведомления в базе данных для отображения при следующем входе.
 */
import { Server } from 'socket.io';
import { query } from '../db/pool';
import { createNotification, getUnreadNotifications } from './user-notifications';

export type NotificationPreference = 'notif_duel' | 'notif_safe' | 'notif_referral' | 'notif_vault';

let io: Server | null = null;

export function initNotifications(socketServer: Server) {
  io = socketServer;
}

/**
 * Отправить уведомление пользователю
 * @param userId - ID пользователя
 * @param message - Текст уведомления
 * @param data - Дополнительные данные
 * @param persist - Сохранить в базе данных (по умолчанию true)
 * @param type - Тип уведомления (для классификации)
 * @param title - Заголовок уведомления
 * @param expiresAt - Дата истечения (опционально, по умолчанию не истекает)
 */
export async function notify(
  userId: number, 
  message: string, 
  data?: any,
  persist: boolean = true,
  type: string = 'general',
  title: string = 'Уведомление',
  expiresAt?: Date
) {
  // Сохраняем в базе данных — ДО отправки в сокет. Клиент на событие
  // `notification` сразу перечитывает список с сервера: если событие ушло
  // раньше записи, он получал пустой ответ, а досоздание уведомлений о дуэлях
  // (ensureDuelResultNotifications) не находило строку и плодило дубли.
  if (persist) {
    try {
      await createNotification(userId, type, title, message, data);
    } catch (e: any) {
      console.error(`[NOTIFY] Error saving notification for user ${userId}:`, e.message);
    }
  }

  // Отправляем через WebSocket если пользователь подключён
  if (io) {
    io.to(`user:${userId}`).emit('notification', { message, data, type, title });
  }

  console.log(`[NOTIFY user ${userId}] ${type}: ${message}`);
}

/** Категорийное уведомление с учётом настройки пользователя и дедупликацией lifecycle-события. */
export async function notifyPreferred(
  userId: number, preference: NotificationPreference, message: string,
  type: string, title: string, data?: any, entityType?: string, entityId?: number
): Promise<boolean> {
  const enabled = await query(`SELECT ${preference} AS enabled FROM users WHERE id=$1`, [userId]);
  if (!enabled.rows[0]?.enabled) return false;
  const notificationId = await createNotification(userId, type, title, message, data, entityType, entityId);
  if (notificationId == null) return false;
  if (io) io.to(`user:${userId}`).emit('notification', { id: notificationId, message, data, type, title });
  return true;
}

/** Критическое lifecycle-уведомление без категорийного выключателя. */
export async function notifyLifecycleOnce(userId:number,message:string,type:string,title:string,data:any,entityType:string,entityId:number) {
  const id=await createNotification(userId,type,title,message,data,entityType,entityId);
  if(id==null) return false;
  if(io) io.to(`user:${userId}`).emit('notification',{id,message,data,type,title});
  return true;
}

/**
 * Отправить уведомление о дуэли (с сохранением в базе)
 */
export async function notifyDuelResult(
  userId: number,
  duelId: number,
  message: string,
  data?: any
) {
  await notifyPreferred(userId, 'notif_duel', message, 'duel_result', 'Результат дуэли', data, 'duel', duelId);
}

/** Отправить событие только в комнату конкретного пользователя. */
export function emitToUser(userId: number, event: string, data: any) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}

export function broadcast(event: string, data: any) {
  if (io) io.emit(event, data);
}

/**
 * Получить непрочитанные уведомления пользователя из базы
 */
export async function getUnreadUserNotifications(userId: number) {
  return await getUnreadNotifications(userId);
}
