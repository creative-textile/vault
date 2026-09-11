/**
 * Уведомления.
 * В проде — отправка через Telegram Bot API sendMessage.
 * В демо — рассылаем через WebSocket как in-app уведомления.
 */
import { Server } from 'socket.io';

let io: Server | null = null;

export function initNotifications(socketServer: Server) {
  io = socketServer;
}

export function notify(userId: number, message: string, data?: any) {
  if (io) {
    io.to(`user:${userId}`).emit('notification', { message, data });
  }
  console.log(`[NOTIFY user ${userId}] ${message}`);
}

export function broadcast(event: string, data: any) {
  if (io) io.emit(event, data);
}
