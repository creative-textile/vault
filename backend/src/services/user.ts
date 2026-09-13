import { query } from '../db/pool';
import { getUser, getUserByTelegramId, modifyBalance, getBalanceSnapshot } from './balance';
import { generateRefCode } from './referral';
import { getSetting } from './revenue';
import { config } from '../config';
import { notifyPreferred } from './notifications';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/** Максимальный возраст `auth_date` в initData, после которого вход отвергается. */
const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

/**
 * Проверка подписи Telegram WebApp initData по официальному алгоритму:
 *   secret_key = HMAC_SHA256(key = "WebAppData", msg = BOT_TOKEN)
 *   data_check_string = отсортированные "key=value" без поля hash, через "\n"
 *   hash == HMAC_SHA256(key = secret_key, msg = data_check_string).hex
 *
 * Прежняя «верификация» просто читала `user` из query-строки, поэтому любой
 * запрос вида `user={"id":<чужой id>}` входил в ЛЮБОЙ аккаунт: подписи не
 * проверялось, BOT_TOKEN не использовался, `auth_date` игнорировался.
 */
export function verifyTelegramInitData(initData: string): { id: number; username: string | null } {
  if (!config.botToken || config.botToken === 'demo_token') {
    throw new Error('BOT_TOKEN не настроен: реальная авторизация Telegram невозможна');
  }
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new Error('Invalid Telegram initData');

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(receivedHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid Telegram initData');
  }

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate || (Date.now() / 1000 - authDate) > INIT_DATA_MAX_AGE_SEC) {
    throw new Error('Telegram initData устарел');
  }

  const userStr = params.get('user');
  if (!userStr) throw new Error('Invalid Telegram initData');
  let tgUser: any;
  try { tgUser = JSON.parse(userStr); } catch { throw new Error('Invalid Telegram initData'); }
  const telegramId = Number(tgUser.id);
  if (!Number.isInteger(telegramId) || telegramId <= 0) throw new Error('Invalid Telegram initData');
  return { id: telegramId, username: tgUser.username || tgUser.first_name || null };
}

/**
 * Telegram WebApp авторизация: верифицирует initData, возвращает JWT.
 * Вход по `demo:<id>` работает ТОЛЬКО при DEMO_MODE=true — в реальном режиме
 * такой запрос отклоняется, иначе любой посетитель получал аккаунт с нужным
 * telegram_id без единой проверки.
 */
export async function authenticateTelegram(initData: string, refCode?: string) {
  let telegramId: number;
  let username: string | null = null;

  if (initData.startsWith('demo:')) {
    if (!config.demoMode) throw new Error('Демо-вход отключён');
    // demo:<telegram_id>[:<username>]
    const parts = initData.split(':');
    telegramId = parseInt(parts[1], 10);
    if (!Number.isInteger(telegramId) || telegramId <= 0) throw new Error('Invalid demo initData');
    username = parts[2] || ('user' + telegramId);
  } else {
    ({ id: telegramId, username } = verifyTelegramInitData(initData));
  }

  let user = await getUserByTelegramId(telegramId);
  let isNew = false;

  if (!user) {
    // Найти рефовода
    let referrerId: number | null = null;
    if (refCode) {
      const refRes = await query('SELECT id FROM users WHERE ref_code = $1', [refCode]);
      if (refRes.rows.length) referrerId = refRes.rows[0].id;
    }

    const code = generateRefCode();
    const ins = await query(
      `INSERT INTO users (telegram_id, username, ref_code, referred_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [telegramId, username, code, referrerId]
    );
    user = await getUser(ins.rows[0].id);
    isNew = true;
    if (referrerId) await notifyPreferred(referrerId,'notif_referral',`Новый реферал: @${username || `user${telegramId}`}`,
      'new_referral','Новый реферал',{referral_id:user!.id},'referral',user!.id);
  } else {
    await query('UPDATE users SET username = COALESCE($1,username), last_active = NOW(), notified_dead=FALSE, dead_deadline=NULL WHERE id = $2', [username, user.id]);
  }

  const token = jwt.sign({ userId: user!.id, telegramId }, config.jwtSecret, { expiresIn: '30d' });
  return { token, user: user!, isNew };
}

export async function getUserFromToken(token: string): Promise<any> {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    const user = await getUser(decoded.userId);
    if (!user) return null;
    // Токен выдаётся конкретному человеку (telegram_id), а не «строке с номером N».
    // После сброса/пересоздания БД id снова начинаются с 1, и старый токен из другого
    // браузера иначе молча садится в чужой аккаунт с тем же id: человек видит
    // чужой баланс и играет чужой вклад. Несовпал telegram_id — токен недействителен,
    // клиент получит 401 и войдёт заново уже своим аккаунтом.
    if (decoded.telegramId != null && Number(user.telegram_id) !== Number(decoded.telegramId)) {
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

export async function getProfile(userId: number) {
  const user = await getUser(userId);
  if (!user) throw new Error('Не найден');

  // Статистика
  const totalBetsRes = await query(
    `SELECT COALESCE(SUM(ABS(amount)), 0) as v FROM transactions WHERE user_id = $1 AND type = 'bet'`,
    [userId]
  );
  const totalWinsRes = await query(
    `SELECT COALESCE(SUM(amount), 0) as v FROM transactions WHERE user_id = $1 AND type = 'win'`,
    [userId]
  );

  // Сколько денег «в деле», но не в балансе: вклад в сейф и тело вклада VAULT
  const locked = await getBalanceSnapshot(userId);

  return {
    id: user.id,
    telegram_id: user.telegram_id,
    username: user.username,
    balance: user.balance,
    frozen_balance: user.frozen_balance,
    available: user.balance - user.frozen_balance,
    safe_locked: locked.safe_locked,
    vault_locked: locked.vault_locked,
    deposit_address: user.deposit_address,
    withdraw_address: user.withdraw_address,
    ref_code: user.ref_code,
    referred_by: user.referred_by,
    auto_safe_percent: user.auto_safe_percent,
    total_bets: parseFloat(totalBetsRes.rows[0].v),
    total_wins: parseFloat(totalWinsRes.rows[0].v),
    pin_set: !!user.pin_hash,
    banned: user.banned,
    ban_reason: user.ban_reason,
    notif_duel: user.notif_duel,
    notif_safe: user.notif_safe,
    notif_referral: user.notif_referral,
    notif_vault: user.notif_vault
  };
}

export async function getTransactionHistory(userId: number, limit = 50) {
  const res = await query(
    `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return res.rows.map(r => ({
    id: r.id,
    type: r.type,
    amount: parseFloat(r.amount),
    balance_after: parseFloat(r.balance_after),
    game_type: r.game_type,
    description: r.description,
    created_at: r.created_at
  }));
}

export async function updateSettings(userId: number, settings: Partial<{
  withdraw_address: string,
  auto_safe_percent: number,
  notif_duel: boolean,
  notif_safe: boolean,
  notif_referral: boolean,
  notif_vault: boolean
}>) {
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;
  const allowed=new Set(['withdraw_address','auto_safe_percent','notif_duel','notif_safe','notif_referral','notif_vault']);
  for (const [k, v] of Object.entries(settings)) {
    if(!allowed.has(k)) throw new Error('Неизвестная настройка');
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (!fields.length) return;
  values.push(userId);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, values);
}
