import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(token?: string): Socket {
  if (!socket) {
    // В production через Nginx — подключаемся к тому же origin.
    // В dev-режиме Vite проксирует /socket.io на backend.
    socket = io({
      auth: { token: token || localStorage.getItem('vault_token') || '' },
      path: '/socket.io'
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
