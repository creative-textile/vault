// В production Nginx раздаёт и статику, и проксирует /api и /socket.io
// на backend. Поэтому используем относительные пути (пустая строка = тот же origin).
// Для dev-режима с `npm run dev` Vite proxy перехватывает /api и /socket.io
// и отправляет их на localhost:8000 (см. vite.config.ts).
const API_URL = '';

import { getStoredToken } from '../utils/tokenStorage';

function getDeviceId(): string {
  let id=localStorage.getItem('vault:device-id');
  if(!id) { id=crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`; localStorage.setItem('vault:device-id',id); }
  return id;
}

function getToken(): string | null {
  return getStoredToken();
}

export class ApiError extends Error {
  constructor(message:string,public status:number,public retryAfter?:number){super(message);this.name='ApiError';}
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let adminPassword='';
  if(path.startsWith('/api/admin')) {
    adminPassword=sessionStorage.getItem('vault:admin-password')||'';
    if(!adminPassword) { adminPassword=window.prompt('Пароль администратора')||''; if(adminPassword) sessionStorage.setItem('vault:admin-password',adminPassword); }
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(adminPassword ? { 'X-Admin-Password': adminPassword } : {}),
      'X-Device-Id': getDeviceId(),
      ...options.headers
    }
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok && path.startsWith('/api/admin') && res.status===401) sessionStorage.removeItem('vault:admin-password');
  // Любой актуальный 401 будит единый auth bootstrap. Токен кладём в detail,
  // чтобы запоздалый ответ старой сессии не мог удалить уже выданный новый JWT.
  if (res.status===401 && token) window.dispatchEvent(new CustomEvent('vault:unauthorized',{detail:{token}}));
  if (!res.ok) throw new ApiError(data.error || 'Ошибка',res.status,Number(data.retry_after)||undefined);
  return data as T;
}

// Публичная конфигурация (загружается один раз)
let _pubConfig: any = null;
export const publicConfig = async () => {
  if (_pubConfig) return _pubConfig;
  _pubConfig = await api('/api/config');
  return _pubConfig;
};

export const replayApi = { get: (game:'rocket'|'duel'|'safe',id:number) => api(`/api/replay/${game}/${id}`) };

export const authApi = {
  telegram: (initData: string, refCode?: string) =>
    api('/api/auth/telegram', { method: 'POST', body: JSON.stringify({ initData, refCode }) }),
  demoLogin: (telegramId: number, username?: string, refCode?: string) =>
    api('/api/auth/telegram', { method: 'POST', body: JSON.stringify({ initData: `demo:${telegramId}:${username || 'user' + telegramId}`, refCode }) })
};

// Публичная статистика проекта (главный экран): участники, дни, пополнения, выплаты
export const statsApi = {
  summary: () => api('/api/stats/summary')
};

export const profileApi = {
  get: () => api('/api/profile'),
  update: (data: any) => api('/api/profile', { method: 'PATCH', body: JSON.stringify(data) }),
  transactions: (limit = 50) => api(`/api/transactions?limit=${limit}`)
};

export const walletApi = {
  depositAddress: () => api('/api/wallet/deposit-address'),
  demoDeposit: (amount: number) => api('/api/wallet/demo-deposit', { method: 'POST', body: JSON.stringify({ amount }) }),
  withdraw: (amount: number, pin: string, address?: string) =>
    api('/api/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount, pin, address }) }),
  setPin: (pin: string) => api('/api/wallet/set-pin', { method: 'POST', body: JSON.stringify({ pin }) }),
  setWithdrawAddress: (address: string) =>
    api('/api/wallet/set-withdraw-address', { method: 'POST', body: JSON.stringify({ address }) })
};

export const rocketApi = {
  start: (bet: number) => api('/api/rocket/start', { method: 'POST', body: JSON.stringify({ bet }) }),
  history: (limit = 50) => api(`/api/rocket/history?limit=${limit}`),
  bankroll: () => api('/api/rocket/bankroll')
};

export const duelApi = {
  create: (amount: number) => api('/api/duel/create', { method: 'POST', body: JSON.stringify({ amount }) }),
  lobby: () => api('/api/duel/lobby'),
  accept: (id: number) => api(`/api/duel/accept/${id}`, { method: 'POST' }),
  cancel: (id: number) => api(`/api/duel/cancel/${id}`, { method: 'POST' }),
  history: () => api('/api/duel/history'),
  get: (id: number) => api(`/api/duel/${id}`),
  notifications: () => api('/api/duel/notifications'),
  markNotificationAsRead: (id: number) => api(`/api/duel/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsAsRead: () => api('/api/duel/notifications/read-all', { method: 'POST' }),
  markDuelNotificationsAsRead: (duelId: number) =>
    api(`/api/duel/notifications/read-duel/${duelId}`, { method: 'POST' }),
  getUnreadCount: () => api('/api/duel/notifications/count'),
  rematch: (id:number,multiplier=1) => api(`/api/duel/rematch/${id}`,{method:'POST',body:JSON.stringify({multiplier})}),
  decline: (id:number) => api(`/api/duel/decline/${id}`,{method:'POST'})
};

export const safeApi = {
  current: () => api('/api/safe/current'),
  deposit: (amount: number) => api('/api/safe/deposit', { method: 'POST', body: JSON.stringify({ amount }) }),
  cancel: () => api('/api/safe/cancel', { method: 'POST' }),
  /**
   * Сдать результат взлома. Кроме времени отправляем моменты тапов (мс от старта
   * вращения) и число промахов: сервер сам сверяет цифры с кодом сейфа и
   * пересчитывает время — подставить произвольные числа не получится.
   */
  // taps — моменты остановки барабанов: по ним сервер сверяет цифры с кодом сейфа
  crack: (time_ms: number, taps?: number[]) =>
    api('/api/safe/crack', { method: 'POST', body: JSON.stringify({ time_ms, taps }) }),
  results: (id: number) => api(`/api/safe/results/${id}`),
  get: (id: number) => api(`/api/safe/${id}`)
};

export const vaultApi = {
  status: () => api('/api/vault/status'),
  lock: (amount: number, term_days: number) =>
    api('/api/vault/lock', { method: 'POST', body: JSON.stringify({ amount, term_days }) }),
  earlyUnlock: (deposit_id: number) =>
    api('/api/vault/early-unlock', { method: 'POST', body: JSON.stringify({ deposit_id }) }),
  history: () => api('/api/vault/history'),
  accruals: () => api('/api/vault/accruals')
};

export const referralApi = {
  stats: () => api('/api/referral/stats')
};

export const adminApi = {
  reconciliation: () => api('/api/admin/reconciliation'),
  antifraud: (status='open') => api(`/api/admin/antifraud?status=${status}`),
  reviewFraud: (id:number,status:string) => api(`/api/admin/antifraud/${id}/review`,{method:'POST',body:JSON.stringify({status})}),
  auditLog: () => api('/api/admin/audit-log'),
  stats: (from?: string, to?: string) => {
    const q = from && to ? `?from=${from}&to=${to}` : '';
    return api('/api/admin/stats' + q);
  },
  rocketBankroll: (add?: number, withdraw?: number) =>
    api('/api/admin/rocket-bankroll', { method: 'POST', body: JSON.stringify({ add, withdraw }) }),
  addPool: (amount: number) => api('/api/admin/add-pool', { method: 'POST', body: JSON.stringify({ amount }) }),
  withdrawPlatform: (amount: number, note?: string) =>
    api('/api/admin/withdraw-platform', { method: 'POST', body: JSON.stringify({ amount, note }) }),
  seedPlatform: (amount: number) => api('/api/admin/seed-platform', { method: 'POST', body: JSON.stringify({ amount }) }),
  getSettings: () => api('/api/admin/settings'),
  setSettings: (s: any) => api('/api/admin/settings', { method: 'POST', body: JSON.stringify(s) }),
  users: (search?: string, limit = 50) => {
    const q = search ? `?search=${encodeURIComponent(search)}&limit=${limit}` : `?limit=${limit}`;
    return api('/api/admin/users' + q);
  },
  userDetail: (id: number) => api(`/api/admin/users/${id}`),
  banUser: (id: number, reason?: string) =>
    api(`/api/admin/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ reason }) }),
  unbanUser: (id: number) => api(`/api/admin/users/${id}/unban`, { method: 'POST' }),
  adjustUser: (id: number, delta: number, reason?: string) =>
    api(`/api/admin/users/${id}/adjust`, { method: 'POST', body: JSON.stringify({ delta, reason }) }),
  // Выплаты пользователям: в реальном режиме вывод создаёт заявку pending,
  // а оператор отправляет USDT вручную и вносит tx_hash (или отклоняет — деньги
  // возвращаются на баланс).
  withdrawals: (status?: 'pending' | 'paid' | 'rejected') =>
    api('/api/admin/withdrawals' + (status ? `?status=${status}` : '')),
  payWithdrawal: (id: number, tx_hash: string) =>
    api(`/api/admin/withdrawals/${id}/pay`, { method: 'POST', body: JSON.stringify({ tx_hash }) }),
  rejectWithdrawal: (id: number, reason?: string) =>
    api(`/api/admin/withdrawals/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  transactions: (params: any = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)); });
    const s = q.toString();
    return api('/api/admin/transactions' + (s ? '?' + s : ''));
  }
};
