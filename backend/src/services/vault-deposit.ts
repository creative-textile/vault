import { query, getClient } from '../db/pool';
import { withTransaction } from '../db/pool';
import { getUser, modifyBalance, getAvailableBalance, modifyBalanceWithClient } from './balance';
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

async function getFixedDailyMax(): Promise<number> {
  const floor = parseFloat(await getSetting('vault_max_floor') || '100');
  const latest = await query(`SELECT max_deposit FROM vault_pool_daily WHERE distributed_at IS NOT NULL ORDER BY date DESC LIMIT 1`);
  return latest.rows.length ? Math.max(floor, parseFloat(latest.rows[0].max_deposit) || floor) : floor;
}

async function lockVaultDepositImpl(userId: number, amount: number, termDays: number) {
  const user = await getUser(userId);
  if (!user) throw new Error('Пользователь не найден');

  const available = await getAvailableBalance(userId);
  const baseMin = parseFloat(await getSetting('vault_min_deposit') || '10');
  // Лимит фиксирован на сутки по последнему закрытому пулу.
  const dynMax = await getFixedDailyMax();
  const dynMin = baseMin;

  if (amount < dynMin) throw new Error(`Минимум $${dynMin}`);
  if (amount > dynMax) throw new Error(`Максимум $${dynMax}`);
  if (Math.round(amount * 100) > Math.round(available * 100)) throw new Error('Недостаточно средств');
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
    `INSERT INTO vault_deposits (user_id, amount, term_days, multiplier, status, unlocks_at)
     VALUES ($1, $2, $3, $4, 'active', $5) RETURNING id, unlocks_at`,
    [userId, amount, termDays, VAULT_MULTIPLIERS[termDays], new Date(Date.now() + termDays * 86400000)]
  );

  return { deposit_id: res.rows[0].id, unlocks_at: res.rows[0].unlocks_at };
}

async function earlyUnlockImpl(userId: number, depositId: number) {
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
  const yesterday = new Date(nowMSK().getTime() - 86400000);
  yesterday.setHours(0, 0, 0, 0);
  const date = yesterday.toISOString().slice(0, 10);
  const revenue = await getPlatformRevenueForDate(yesterday);
  const poolPercent = parseFloat(await getSetting('vault_pool_percent') || '15') / 100;
  const autoPool = Math.round(revenue * poolPercent * 100) / 100;
  const manualPool = parseFloat(await getSetting('manual_pool_addition') || '0');
  const totalPoolCents = Math.round((autoPool + manualPool) * 100);
  const maxFloor = parseFloat(await getSetting('vault_max_floor') || '100');
  const maxMultiplier = parseFloat(await getSetting('vault_max_multiplier') || '10');
  const newMax = Math.max(maxFloor, roundDownClean((totalPoolCents / 100) * maxMultiplier));

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO vault_pool_daily(date,max_deposit) VALUES($1,$2) ON CONFLICT(date) DO NOTHING`,[date,newMax]);
    const claimed=await client.query(`UPDATE vault_pool_daily SET distributed_at=NOW() WHERE date=$1 AND distributed_at IS NULL RETURNING id`,[date]);
    if (!claimed.rows.length) {
      const done=await client.query(`SELECT total_pool FROM vault_pool_daily WHERE date=$1`,[date]);
      await client.query('ROLLBACK');
      return { distributed: parseFloat(done.rows[0]?.total_pool || '0'), completed: 0, already_distributed: true };
    }
    // Автопул физически переводится из кассы. Ручной пул резервируется при добавлении.
    if (autoPool > 0) {
      const cash = await client.query(
        `UPDATE platform_cashbox SET amount=amount-$1, updated_at=NOW()
          WHERE id=1 AND amount >= $1 RETURNING amount`, [autoPool]
      );
      if (!cash.rows.length) throw new Error('Недостаточно средств в кассе для пула VAULT');
    }
    await client.query(`UPDATE settings SET value='0' WHERE key='manual_pool_addition'`);
    const depRes = await client.query(`SELECT * FROM vault_deposits WHERE status='active' ORDER BY id FOR UPDATE`);
    const deposits = depRes.rows;
    const weights = deposits.map(d => parseFloat(d.amount) * parseFloat(d.multiplier));
    const totalWeight = weights.reduce((a,b)=>a+b,0);
    const allocations = deposits.map((d,i) => {
      const exact = totalWeight > 0 ? totalPoolCents * weights[i] / totalWeight : 0;
      return { d, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
    });
    let remainder = totalPoolCents - allocations.reduce((n,a)=>n+a.cents,0);
    [...allocations].sort((a,b)=>b.fraction-a.fraction || a.d.id-b.d.id).forEach(a => {
      if (remainder-- > 0) a.cents++;
    });
    let totalLocked = 0;
    for (const a of allocations) {
      const amount = parseFloat(a.d.amount); totalLocked += amount;
      const profit = a.cents / 100;
      await client.query(`UPDATE vault_deposits SET accumulated_profit=accumulated_profit+$1, days_elapsed=days_elapsed+1 WHERE id=$2`, [profit,a.d.id]);
      await client.query(
        `INSERT INTO vault_deposit_accruals (deposit_id,user_id,date,pool_amount,profit)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (deposit_id,date) DO NOTHING`,
        [a.d.id,a.d.user_id,date,totalPoolCents/100,profit]
      );
    }
    const baseRate = totalLocked ? (totalPoolCents/100)/totalLocked*100 : 0;
    await client.query(
      `INSERT INTO vault_pool_daily (date,platform_revenue,auto_pool,manual_pool,total_pool,total_locked,depositors_count,base_rate,max_deposit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (date) DO UPDATE SET platform_revenue=$2,auto_pool=$3,manual_pool=$4,total_pool=$5,total_locked=$6,depositors_count=$7,base_rate=$8,max_deposit=$9`,
      [date,revenue,autoPool,manualPool,totalPoolCents/100,totalLocked,deposits.length,+baseRate.toFixed(4),newMax]
    );
    await client.query('COMMIT');
    return { distributed: totalPoolCents/100, completed: 0 };
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

/** Выплатить созревшие вклады после полных 24 часов срока. */
export async function completeMatureVaultDeposits(): Promise<number> {
  const rows = await query(`SELECT id FROM vault_deposits WHERE status='active' AND unlocks_at <= NOW() ORDER BY id`);
  let completed=0;
  for (const row of rows.rows) {
    const client=await getClient();
    try {
      await client.query('BEGIN');
      const claim=await client.query(`UPDATE vault_deposits SET status='completed',unlocked_at=NOW() WHERE id=$1 AND status='active' AND unlocks_at<=NOW() RETURNING *`,[row.id]);
      if (!claim.rows.length) { await client.query('ROLLBACK'); continue; }
      const d=claim.rows[0], payout=Math.round((parseFloat(d.amount)+parseFloat(d.accumulated_profit))*100)/100;
      await modifyBalanceWithClient(client,d.user_id,payout,'vault_payout',{description:`Вклад ${d.term_days} дней завершён, прибыль $${parseFloat(d.accumulated_profit).toFixed(2)}`});
      await client.query('COMMIT'); completed++;
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  return completed;
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
  const dynMax = await getFixedDailyMax();
  const dynMin = baseMin;
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
  const value=Math.round(amount*100)/100;
  if (!(value>0)) throw new Error('Сумма должна быть больше нуля');
  const client=await getClient();
  try {
    await client.query('BEGIN');
    const cash=await client.query(`UPDATE platform_cashbox SET amount=amount-$1,updated_at=NOW() WHERE id=1 AND amount >= $1 RETURNING amount`,[value]);
    if (!cash.rows.length) throw new Error('Недостаточно средств в кассе платформы');
    await client.query(`INSERT INTO settings(key,value) VALUES('manual_pool_addition',$1) ON CONFLICT(key) DO UPDATE SET value=(COALESCE(settings.value,'0')::numeric+$1::numeric)::text`,[value]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
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


// Составные денежные операции целиком выполняются в одной SQL-транзакции.
export const lockVaultDeposit: typeof lockVaultDepositImpl = (...args: Parameters<typeof lockVaultDepositImpl>) => withTransaction(() => lockVaultDepositImpl(...args));
export const earlyUnlock: typeof earlyUnlockImpl = (...args: Parameters<typeof earlyUnlockImpl>) => withTransaction(() => earlyUnlockImpl(...args));
