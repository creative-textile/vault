import { io, Socket } from 'socket.io-client';
import { getStoredToken } from '../utils/tokenStorage';

let socket: Socket | null = null;
let socketToken: string | null = null;

export function getSocket(token?: string): Socket {
  const t = token || getStoredToken() || '';

  // Сокет создаётся один раз на вкладку и передаёт токен в рукопожатии: по нему
  // сервер определяет пользователя и добавляет сокет в комнату user:<id>. Если
  // вкладка открылась с устаревшим токеном (сброс БД, истёк срок) или сокет
  // успел создаться до входа (его без токена создаёт, например, бейдж летящей
  // ракеты), сервер не может её опознать — и такая вкладка НЕ получает ни
  // уведомлений (в том числе о результате дуэли), ни balance_updated. Поэтому
  // при смене токена сокет переподключается с новым токеном.
  if (!socket) {
    // В production через Nginx — подключаемся к тому же origin.
    // В dev-режиме Vite проксирует /socket.io на backend.
    socket = io({ auth: { token: t }, path: '/socket.io' });
    socketToken = t;
    return socket;
  }

  if (socketToken !== t) {
    // Переподключаем ТОТ ЖЕ объект: слушатели компонентов (бейдж летящей
    // ракеты, экран ракеты, редиректор взлома) переживают reconnect, а сервер
    // заново прогоняет auth-middleware и добавляет сокет в комнату user:<id>.
    socketToken = t;
    socket.auth = { token: t };
    socket.disconnect();
    socket.connect();
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    socketToken = null;
  }
}
