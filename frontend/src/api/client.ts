// В production Nginx раздаёт и статику, и проксирует /api и /socket.io
// на backend. Поэтому используем относительные пути (пустая строка = тот же origin).
// Для dev-режима с `npm run dev` Vite proxy перехватывает /api и /socket.io
// и отправляет их на localhost:8000 (см. vite.config.ts).
const API_URL = '';

import { getStoredToken } from '../utils/tokenStorage';
import { dialog } from '../components/ui/Dialog';

function getDeviceId(): string {
  // Хранилище может быть недоступно (приватный режим, WebView, iframe без
  // same-origin) — тогда id живёт в памяти вкладки: он нужен только как ключ
  // лимитера, его потеря не критична, а исключение сломало бы все запросы.
  try {
    let id=localStorage.getItem('vault:device-id');
    if(!id) { id=crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`; localStorage.setItem('vault:device-id',id); }
    return id;
  } catch {
    return deviceMemoryId;
  }
}

const deviceMemoryId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function getToken(): string | null {
  return getStoredToken();
}

export class ApiError extends Error {
  constructor(message:string,public status:number,public retryAfter?:number){super(message);this.name='ApiError';}
}

const ADMIN_PWD_KEY = 'vault:admin-password';

/** Хранилище может бросать исключение — не роняем из-за этого запрос. */
function readSession(key: string): string {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}
function writeSession(key: string, value: string | null) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* приватный режим / WebView без хранилищ */ }
}

/**
 * Пароль администратора спрашиваем одним окном на все параллельные запросы.
 *
 * Админка при открытии шлёт несколько запросов разом; без single-flight каждый
 * из них поднял бы своё окно ввода, и админу пришлось бы вводить пароль N раз.
 * Нативный `window.prompt` здесь больше не используется: в Telegram Mini App
 * он выглядит чужеродно, а на части WebView просто не показывается.
 */
let adminPasswordPrompt: Promise<string> | null = null;
let adminPasswordMemory = '';

async function ensureAdminPassword(): Promise<string> {
  const stored = readSession(ADMIN_PWD_KEY) || adminPasswordMemory;
  if (stored) return stored;
  if (!adminPasswordPrompt) {
    adminPasswordPrompt = dialog.prompt({
      title: 'Пароль администратора',
      message: 'Раздел доступен только владельцу проекта. Пароль запоминается до конца сессии.',
      input: { type: 'password', placeholder: 'Введите пароль', required: true },
      confirmText: 'Войти',
      tone: 'gold',
      icon: 'key'
    }).then((value) => {
      const pwd = (value || '').trim();
      if (pwd) { adminPasswordMemory = pwd; writeSession(ADMIN_PWD_KEY, pwd); }
      return pwd;
    }).finally(() => { adminPasswordPrompt = null; });
  }
  return adminPasswordPrompt;
}

export function forgetAdminPassword() {
  adminPasswordMemory = '';
  writeSession(ADMIN_PWD_KEY, null);
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isAdminPath = path.startsWith('/api/admin');
  let adminPassword = '';
  if (isAdminPath) {
    adminPassword = await ensureAdminPassword();
    // Пароль не ввели (окно закрыли) — запрос не отправляем вовсе. Иначе сервер
    // ответил бы 401 на «нет пароля», и приложение приняло бы это за потерю
    // сессии: сбросило токен и перезапустило вход.
    if (!adminPassword) throw new ApiError('Требуется пароль администратора', 401);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(adminPassword ? { 'X-Admin-Password': adminPassword } : {}),
        'X-Device-Id': getDeviceId(),
        ...options.headers
      }
    });
  } catch {
    // Сеть/CORS: fetch отверг промис. Без явного текста экран входа молчал бы.
    throw new ApiError('Нет связи с сервером API. Проверьте, что backend запущен и доступен по этому адресу.', 0);
  }
  // Тело может быть не JSON: на Vercel без backend `/api/*` отдаёт HTML-404, а не
  // `{"error": ...}`. Раньше `data` становился `{}`, текст ошибки — undefined, и
  // экран входа крутил спиннер вечно: пользователь видел «Открываем хранилище…»
  // без объяснения. Теперь причина называется прямо.
  const data = await res.json().catch(()=>({}));
  if (!res.ok && !data.error) {
    data.error = res.status === 404
      ? 'Сервер API недоступен: эта сборка фронтенда развёрнута без backend (Vercel раздаёт только статику).'
      : `Сервер ответил ${res.status} без описания ошибки`;
  }
  if (!res.ok && isAdminPath && res.status===401) forgetAdminPassword();
  // Любой актуальный 401 будит единый auth bootstrap. Токен кладём в detail,
  // чтобы запоздалый ответ старой сессии не мог удалить уже выданный новый JWT.
  //
  // Событие шлём и когда токена НЕТ: раньше условие `&& token` оставляло
  // приложение в мёртвой точке — запросы уходили без Authorization, каждый
  // отвечал 401, а перезапуск входа никто не инициировал (помогал только
  // рефреш страницы). Эндпоинты входа и админский пароль исключаем: там 401
  // означает не потерю сессии, а неверные учётные данные.
  if (res.status===401 && !path.startsWith('/api/auth') && !isAdminPath) {
    window.dispatchEvent(new CustomEvent('vault:unauthorized',{detail:{token}}));
  }
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
  /**
   * Лимиты ставки Ракеты. Путь исторически называется `/bankroll`, но кассу он
   * больше не отдаёт (это админская цифра) — только `min_bet`, `max_bet`
   * (`null` = без лимита) и `max_bet_percent`.
   */
  limits: () => api('/api/rocket/bankroll')
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
