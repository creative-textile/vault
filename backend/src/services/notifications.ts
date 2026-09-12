/**
 * Уведомления.
 * В проде — отправка через Telegram Bot API sendMessage.
 * В демо — рассылаем через WebSocket как in-app уведомления.
 * Также сохраняем уведомления в базе данных для отображения при следующем входе.
 */
import { Server } from 'socket.io';
import { createNotification, getUnreadNotifications } from './user-notifications';

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

/**
 * Отправить уведомление о дуэли (с сохранением в базе)
 */
export async function notifyDuelResult(
  userId: number,
  duelId: number,
  message: string,
  data?: any
) {
  await notify(
    userId,
    message,
    data,
    true,
    'duel_result',
    'Результат дуэли'
  );
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
