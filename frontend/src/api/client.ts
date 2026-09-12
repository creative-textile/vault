// В production Nginx раздаёт и статику, и проксирует /api и /socket.io
// на backend. Поэтому используем относительные пути (пустая строка = тот же origin).
// Для dev-режима с `npm run dev` Vite proxy перехватывает /api и /socket.io
// и отправляет их на localhost:8000 (см. vite.config.ts).
const API_URL = '';

function getToken(): string | null {
  return localStorage.getItem('vault_token');
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data as T;
}

// Публичная конфигурация (загружается один раз)
let _pubConfig: any = null;
export const publicConfig = async () => {
  if (_pubConfig) return _pubConfig;
  _pubConfig = await api('/api/config');
  return _pubConfig;
};

export const authApi = {
  telegram: (initData: string, refCode?: string) =>
    api('/api/auth/telegram', { method: 'POST', body: JSON.stringify({ initData, refCode }) }),
  demoLogin: (telegramId: number, username?: string, refCode?: string) =>
    api('/api/auth/telegram', { method: 'POST', body: JSON.stringify({ initData: `demo:${telegramId}:${username || 'user' + telegramId}`, refCode }) })
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
  pending: () => api('/api/duel/pending'),
  notifications: () => api('/api/duel/notifications'),
  markNotificationAsRead: (id: number) => api(`/api/duel/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsAsRead: () => api('/api/duel/notifications/read-all', { method: 'POST' }),
  markDuelNotificationsAsRead: (duelId: number) =>
    api(`/api/duel/notifications/read-duel/${duelId}`, { method: 'POST' }),
  getUnreadCount: () => api('/api/duel/notifications/count')
};

export const safeApi = {
  current: () => api('/api/safe/current'),
  deposit: (amount: number) => api('/api/safe/deposit', { method: 'POST', body: JSON.stringify({ amount }) }),
  cancel: () => api('/api/safe/cancel', { method: 'POST' }),
  crack: (time_ms: number) => api('/api/safe/crack', { method: 'POST', body: JSON.stringify({ time_ms }) }),
  results: (id: number) => api(`/api/safe/results/${id}`),
  get: (id: number) => api(`/api/safe/${id}`)
};

export const vaultApi = {
  status: () => api('/api/vault/status'),
  lock: (amount: number, term_days: number) =>
    api('/api/vault/lock', { method: 'POST', body: JSON.stringify({ amount, term_days }) }),
  earlyUnlock: (deposit_id: number) =>
    api('/api/vault/early-unlock', { method: 'POST', body: JSON.stringify({ deposit_id }) }),
  history: () => api('/api/vault/history')
};

export const referralApi = {
  stats: () => api('/api/referral/stats')
};

export const adminApi = {
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
  startCracking: () => api('/api/admin/start-cracking', { method: 'POST' }),
  finalizeCracking: () => api('/api/admin/finalize-cracking', { method: 'POST' }),
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
  transactions: (params: any = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)); });
    const s = q.toString();
    return api('/api/admin/transactions' + (s ? '?' + s : ''));
  }
};
