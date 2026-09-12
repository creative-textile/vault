import { query } from '../db/pool';
import { getUser, getUserByTelegramId, modifyBalance } from './balance';
import { generateRefCode } from './referral';
import { getSetting } from './revenue';
import { config } from '../config';
import jwt from 'jsonwebtoken';

/**
 * Telegram WebApp авторизация: верифицирует initData от ТГ, возвращает JWT.
 * В демо-режиме позволяет передавать telegram_id напрямую (для тестов).
 */
export async function authenticateTelegram(initData: string, refCode?: string) {
  let telegramId: number;
  let username: string | null = null;

  if (config.demoMode && initData.startsWith('demo:')) {
    // demo:<telegram_id>[:<username>]
    const parts = initData.split(':');
    telegramId = parseInt(parts[1]);
    username = parts[2] || ('user' + telegramId);
  } else {
    // Простая верификация для прод-режима — парсим initData
    // (Полный алгоритм: проверка HMAC с bot_token по доке Telegram)
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (!userStr) throw new Error('Invalid Telegram initData');
    const tgUser = JSON.parse(userStr);
    telegramId = tgUser.id;
    username = tgUser.username || tgUser.first_name || null;
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
  } else if (username && user.username !== username) {
    await query('UPDATE users SET username = $1, last_active = NOW() WHERE id = $2', [username, user.id]);
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

  return {
    id: user.id,
    telegram_id: user.telegram_id,
    username: user.username,
    balance: user.balance,
    frozen_balance: user.frozen_balance,
    available: user.balance - user.frozen_balance,
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
  for (const [k, v] of Object.entries(settings)) {
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (!fields.length) return;
  values.push(userId);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, values);
}
