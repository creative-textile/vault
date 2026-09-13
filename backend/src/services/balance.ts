import { query } from '../db/pool';
import { emitToUser } from './notifications';

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
    // Баланс на экране должен меняться сразу, а не по следующему опросу /api/profile.
    // Вместе с цифрами отдаём и «где деньги» (заморожено в дуэлях, вложено в сейф,
    // во вкладе): пояснение должно обновляться в тот же момент, что и баланс.
    try {
      const snap = await getBalanceSnapshot(userId);
      emitToUser(userId, 'balance_updated', {
        balance: newBalance,
        frozen_balance: snap.frozen_balance,
        safe_locked: snap.safe_locked,
        vault_locked: snap.vault_locked
      });
    } catch { /* уведомление не должно ломать операцию с балансом */ }
    return newBalance;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Снимок «где деньги игрока».
 *
 *  - `frozen_balance` — ставки в ожидании дуэли: деньги В балансе, но тратить их
 *    нельзя (`available = balance − frozen_balance`);
 *  - `safe_locked` — вклады в сейфы, которые ещё собираются или взламываются
 *    (после розыгрыша или отмены раунда сумма уходит в баланс/приз);
 *  - `vault_locked` — тело активных вкладов VAULT (вернётся по сроку или при
 *    досрочном расторжении).
 *
 * Сейф и вклад СПИСЫВАЮТ деньги с баланса в момент операции, поэтому без этих
 * строк игрок видит просто уменьшившуюся цифру и не понимает, куда делись
 * деньги. Отдаются в `GET /api/profile` и в socket-событии `balance_updated`.
 */
export async function getBalanceSnapshot(userId: number): Promise<{
  frozen_balance: number;
  safe_locked: number;
  vault_locked: number;
}> {
  // Три независимых запроса (не коррелированные подзапросы в SELECT): так
  // снимок одинаково считается и в PostgreSQL, и в pg-mem, на котором
  // запускаются смоук-тесты.
  const [u, safe, vault] = await Promise.all([
    query(`SELECT frozen_balance FROM users WHERE id = $1`, [userId]),
    // Вклад в сейф «в деле», пока раунд собирается или взламывается: после
    // розыгрыша сумма превращается в приз, после отмены — возвращается
    query(`SELECT COALESCE(SUM(sd.amount), 0) AS v
             FROM safe_deposits sd
             JOIN safes s ON s.id = sd.safe_id
            WHERE sd.user_id = $1 AND s.status IN ('collecting', 'cracking')`, [userId]),
    query(`SELECT COALESCE(SUM(vd.amount), 0) AS v
             FROM vault_deposits vd
            WHERE vd.user_id = $1 AND vd.status = 'active'`, [userId])
  ]);
  const round2 = (v: any) => Math.round((parseFloat(v) || 0) * 100) / 100;
  return {
    frozen_balance: round2(u.rows[0]?.frozen_balance),
    safe_locked: round2(safe.rows[0]?.v),
    vault_locked: round2(vault.rows[0]?.v)
  };
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
  return Math.round((u.balance - u.frozen_balance) * 100) / 100;
}
