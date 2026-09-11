import { query } from '../db/pool';

const TX_TYPE_LABELS: Record<string, string> = {
  bet: 'Ставка',
  win: 'Выигрыш',
  deposit: 'Пополнение',
  withdraw: 'Вывод',
  referral: 'Реферальное вознаграждение',
  vault_lock: 'Блокировка Вклада',
  vault_return: 'Возврат тела Вклада',
  vault_payout: 'Выплата Вклада',
  safe_cancel: 'Возврат вклада в Сейф',
  duel_cancel: 'Отмена дуэли'
};

/**
 * Единственная функция для изменения баланса пользователя.
 */
export async function modifyBalance(
  userId: number,
  amount: number,
  type: string,
  opts: Partial<{ gameType: string, gameId: number, description: string }> = {}
): Promise<number> {
  const client = await (await import('../db/pool')).pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      'UPDATE users SET balance = balance + $1, last_active = NOW() WHERE id = $2 RETURNING balance',
      [amount, userId]
    );
    const newBalance = parseFloat(res.rows[0].balance);
    const label = opts.description || TX_TYPE_LABELS[type] || type;
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_after, game_type, game_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, type, amount, newBalance, opts.gameType || null, opts.gameId || null, label]
    );
    await client.query('COMMIT');
    return newBalance;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getUser(userId: number) {
  const res = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (res.rows.length === 0) return null;
  const u = res.rows[0];
  u.balance = parseFloat(u.balance);
  u.frozen_balance = parseFloat(u.frozen_balance);
  return u;
}

export async function getUserByTelegramId(tgId: number) {
  const res = await query('SELECT * FROM users WHERE telegram_id = $1', [tgId]);
  if (res.rows.length === 0) return null;
  const u = res.rows[0];
  u.balance = parseFloat(u.balance);
  u.frozen_balance = parseFloat(u.frozen_balance);
  return u;
}

export async function getAvailableBalance(userId: number): Promise<number> {
  const u = await getUser(userId);
  if (!u) return 0;
  return u.balance - u.frozen_balance;
}
