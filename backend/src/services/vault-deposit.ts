import { query, getClient } from '../db/pool';
import { getUser, modifyBalance, getAvailableBalance } from './balance';
import { getSetting, setSetting, getPlatformRevenueForDate } from './revenue';
import { VAULT_MULTIPLIERS, roundDownClean } from '../config';
import { nowMSK } from '../utils/time';

export async function getActiveDeposit(userId: number) {
  const res = await query(
    `SELECT * FROM vault_deposits WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (!res.rows.length) return null;
  const d = res.rows[0];
  return {
    id: d.id,
    amount: parseFloat(d.amount),
    term_days: d.term_days,
    multiplier: parseFloat(d.multiplier),
    days_elapsed: d.days_elapsed,
    accumulated_profit: parseFloat(d.accumulated_profit),
    created_at: d.created_at
  };
}

export async function lockVaultDeposit(userId: number, amount: number, termDays: number) {
  const user = await getUser(userId);
  if (!user) throw new Error('Пользователь не найден');

  const available = await getAvailableBalance(userId);
  const baseMin = parseFloat(await getSetting('vault_min_deposit') || '10');
  const baseMax = parseFloat(await getSetting('vault_max_deposit') || '100');
  // Динамический максимум = пул на сегодня × 10; минимум = max(база, макс/100)
  const pendingPool = await getVaultPool();
  const dynMax = Math.max(baseMax, roundDownClean(Math.max(pendingPool * 10, baseMax)));
  const dynMin = Math.max(baseMin, roundDownClean(dynMax / 100));

  if (amount < dynMin) throw new Error(`Минимум $${dynMin}`);
  if (amount > dynMax) throw new Error(`Максимум $${dynMax}`);
  if (amount > available) throw new Error('Недостаточно средств');
  if (!(termDays in VAULT_MULTIPLIERS)) throw new Error('Срок: 1, 7, 14 или 30 дней');
  if (await getActiveDeposit(userId)) throw new Error('У вас уже есть активный вклад');

  // Деньги уходят со счета ОДНОЙ операцией. Раньше сумма и замораживалась, и
  // списывалась, а available = balance − frozen_balance, поэтому на весь срок
  // вклада доступный баланс был занижен вдвое: положил $500 из $1000 — и играть
  // нечем, хотя свободных денег по факту $500. Заморозка в проекте означает
  // «деньги зарезервированы, но ещё не потрачены» (открытый вызов дуэли), а
  // вклад — это именно трата: тело возвращается только при досрочном разлоке
  // или выплате в срок.
  await modifyBalance(userId, -amount, 'vault_lock', { description: `Вклад на ${termDays} дней` });

  const res = await query(
    `INSERT INTO vault_deposits (user_id, amount, term_days, multiplier, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [userId, amount, termDays, VAULT_MULTIPLIERS[termDays]]
  );

  return { deposit_id: res.rows[0].id, unlocks_at: new Date(Date.now() + termDays * 86400000) };
}

export async function earlyUnlock(userId: number, depositId: number) {
  const res = await query('SELECT * FROM vault_deposits WHERE id = $1', [depositId]);
  if (!res.rows.length) throw new Error('Вклад не найден');
  const d = res.rows[0];
  if (d.user_id !== userId) throw new Error('Не ваш вклад');
  if (d.status !== 'active') throw new Error('Вклад не активен');
  if (d.term_days === 1) throw new Error('Однодневный нельзя разблокировать');

  const burned = parseFloat(d.accumulated_profit);
  const amount = parseFloat(d.amount);

  // Вернуть тело (одна операция: при блокировке деньги списаны, не заморожены)
  await modifyBalance(userId, amount, 'vault_return', { description: 'Досрочный возврат тела вклада' });

  await query("UPDATE vault_deposits SET status = 'early_unlock' WHERE id = $1", [depositId]);

  return { returned: amount, burned };
}

export async function dailyVaultDistribution() {
  // Полночь МСК = вчерашний день по МСК
  const yesterday = new Date(nowMSK().getTime() - 86400000);
  yesterday.setHours(0, 0, 0, 0);

  // Доход за вчера (ракета + дуэль + сейф, ПОСЛЕ рефералов)
  const revenue = await getPlatformRevenueForDate(yesterday);

  const poolPercent = parseInt(await getSetting('vault_pool_percent') || '15') / 100;
  const autoPool = Math.round(revenue * poolPercent * 100) / 100;
  const manualPool = parseFloat(await getSetting('manual_pool_addition') || '0');
  await setSetting('manual_pool_addition', '0');
  const totalPool = Math.round((autoPool + manualPool) * 100) / 100;

  // Активные вклады
  const depRes = await query(`SELECT * FROM vault_deposits WHERE status = 'active'`);
  const deposits = depRes.rows;

  const baseMaxCfg = parseFloat(await getSetting('vault_max_deposit') || '100');
  let newMax = roundDownClean(Math.max(totalPool * 10, baseMaxCfg));
  // Не перезаписываем пользовательское значение «начального максимума»;
  // сохраняем рассчитанный максимум как текущий для UI
  // (храним отдельно в pool_daily.max_deposit)
  // await setSetting('vault_max_deposit', String(newMax));

  if (!deposits.length || totalPool <= 0) {
    await query(
      `INSERT INTO vault_pool_daily (date, platform_revenue, auto_pool, manual_pool, total_pool, total_locked, depositors_count, base_rate, max_deposit)
       VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6)
       ON CONFLICT (date) DO UPDATE SET platform_revenue = $2, auto_pool = $3, manual_pool = $4, total_pool = $5, max_deposit = $6`,
      [yesterday.toISOString().slice(0,10), revenue, autoPool, manualPool, totalPool, newMax]
    );
    return { distributed: 0 };
  }

  const totalWeight = deposits.reduce((sum, d) => sum + parseFloat(d.amount) * parseFloat(d.multiplier), 0);
  let totalLocked = 0;
  let completedCount = 0;

  for (const d of deposits) {
    const amount = parseFloat(d.amount);
    const mult = parseFloat(d.multiplier);
    const weight = amount * mult;
    const dailyProfit = Math.round(totalPool * weight / totalWeight * 100) / 100;
    totalLocked += amount;

    const newDaysElapsed = d.days_elapsed + 1;
    const newProfit = Math.round((parseFloat(d.accumulated_profit) + dailyProfit) * 100) / 100;

    if (newDaysElapsed >= d.term_days) {
      // Выплата
      const payout = Math.round((amount + newProfit) * 100) / 100;
      await modifyBalance(d.user_id, payout, 'vault_payout', {
        description: `Вклад ${d.term_days} дней завершён, прибыль $${newProfit}`
      });
      await query(
        `UPDATE vault_deposits SET status = 'completed', accumulated_profit = $1, days_elapsed = $2, unlocked_at = NOW() WHERE id = $3`,
        [newProfit, newDaysElapsed, d.id]
      );
      completedCount++;
    } else {
      await query(
        `UPDATE vault_deposits SET accumulated_profit = $1, days_elapsed = $2 WHERE id = $3`,
        [newProfit, newDaysElapsed, d.id]
      );
    }
  }

  const baseRate = totalLocked > 0 ? (totalPool / totalLocked * 100) : 0;

  await query(
    `INSERT INTO vault_pool_daily (date, platform_revenue, auto_pool, manual_pool, total_pool, total_locked, depositors_count, base_rate, max_deposit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (date) DO UPDATE SET platform_revenue = $2, auto_pool = $3, manual_pool = $4, total_pool = $5, total_locked = $6, depositors_count = $7, base_rate = $8, max_deposit = $9`,
    [yesterday.toISOString().slice(0,10), revenue, autoPool, manualPool, totalPool, totalLocked, deposits.length - completedCount, +baseRate.toFixed(4), newMax]
  );

  return { distributed: totalPool, completed: completedCount };
}

export async function getVaultHistory(userId: number, limit = 30) {
  const res = await query(
    `SELECT * FROM vault_deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return res.rows.map(d => ({
    id: d.id,
    amount: parseFloat(d.amount),
    term_days: d.term_days,
    multiplier: parseFloat(d.multiplier),
    days_elapsed: d.days_elapsed,
    accumulated_profit: parseFloat(d.accumulated_profit),
    status: d.status,
    created_at: d.created_at,
    unlocked_at: d.unlocked_at
  }));
}

export async function getPoolInfo() {
  const yesterday = new Date(nowMSK().getTime() - 86400000).toISOString().slice(0,10);
  const res = await query('SELECT * FROM vault_pool_daily WHERE date = $1', [yesterday]);
  const pendingPool = await getVaultPool();
  const baseMin = parseFloat(await getSetting('vault_min_deposit') || '10');
  const baseMax = parseFloat(await getSetting('vault_max_deposit') || '100');
  const dynMax = Math.max(baseMax, roundDownClean(Math.max(pendingPool * 10, baseMax)));
  const dynMin = Math.max(baseMin, roundDownClean(dynMax / 100));
  return {
    yesterday: res.rows[0] ? {
      base_rate: parseFloat(res.rows[0].base_rate),
      total_pool: parseFloat(res.rows[0].total_pool),
      total_locked: parseFloat(res.rows[0].total_locked)
    } : { base_rate: 2.1, total_pool: 0, total_locked: 0 },
    pending_pool: pendingPool,
    min_deposit: dynMin,
    max_deposit: dynMax
  };
}

export async function addManualPool(amount: number) {
  const current = parseFloat(await getSetting('manual_pool_addition') || '0');
  await setSetting('manual_pool_addition', String(current + amount));
}

/** Сумма, которая завтра будет распределена: 15% от сегодняшней выручки + накопленная ручная добавка. */
export async function getVaultPool(): Promise<number> {
  const today = nowMSK();
  const revenue = await getPlatformRevenueForDate(today);
  const poolPercent = parseInt(await getSetting('vault_pool_percent') || '15') / 100;
  const autoPool = revenue * poolPercent;
  const manual = parseFloat(await getSetting('manual_pool_addition') || '0');
  return Math.round((autoPool + manual) * 100) / 100;
}

/**
 * Разовая починка вкладов, открытых ПРЕЖНИМ кодом (заморозка + списание).
 *
 * Теперь вклад только списывается, поэтому накопленную заморозку надо снять:
 * иначе она осталась бы у пользователя навсегда и занижала доступный баланс.
 * Вызывается ОДИН раз (флаг `vault_freeze_fix_applied` в settings): вклады,
 * открытые уже по новой схеме, не заморожены, и повторный запуск увёл бы
 * frozen_balance в минус. Маркер-транзакция `vault_unfreeze` защищает от
 * двойной разморозки, если процесс упал посреди починки.
 */
export async function repairVaultFreeze(): Promise<number> {
  const res = await query(`SELECT id, user_id, amount FROM vault_deposits WHERE status = 'active'`);
  let fixed = 0;
  for (const d of res.rows) {
    const amount = parseFloat(d.amount);
    if (!(amount > 0)) continue;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const already = await client.query(
        `SELECT 1 FROM transactions
          WHERE user_id = $1 AND type = 'vault_unfreeze' AND game_id = $2 LIMIT 1`,
        [d.user_id, d.id]
      );
      if (already.rows.length) {
        await client.query('ROLLBACK');
        continue;
      }
      await client.query(
        `UPDATE users SET frozen_balance = frozen_balance - $1 WHERE id = $2`, [amount, d.user_id]);
      const bal = await client.query(`SELECT balance FROM users WHERE id = $1`, [d.user_id]);
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_after, game_type, game_id, description)
         VALUES ($1, 'vault_unfreeze', 0, $2, 'vault', $3, 'Снятие двойной блокировки вклада')`,
        [d.user_id, parseFloat(bal.rows[0]?.balance || '0'), d.id]
      );
      await client.query('COMMIT');
      fixed++;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* соединение уже могло закрыться */ }
      throw e;
    } finally {
      client.release();
    }
  }
  return fixed;
}
