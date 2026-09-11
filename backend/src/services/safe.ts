import { query } from '../db/pool';
import { getUser, modifyBalance, getAvailableBalance } from './balance';
import { logPlatformRevenue, getSetting } from './revenue';
import { payReferral } from './referral';
import { todayMSK } from '../utils/time';

export async function getTodaySafe() {
  const today = todayMSK();
  const res = await query('SELECT * FROM safes WHERE date = $1', [today]);
  if (res.rows.length === 0) return null;
  const s = res.rows[0];
  s.bank = parseFloat(s.bank);
  s.prize_pool = parseFloat(s.prize_pool);
  s.commission_amount = parseFloat(s.commission_amount);
  s.drum_speeds = s.drum_speeds ? s.drum_speeds.map((x: string) => parseFloat(x)) : [];
  return s;
}

export async function getSafeById(id: number) {
  const res = await query('SELECT * FROM safes WHERE id = $1', [id]);
  if (res.rows.length === 0) return null;
  const s = res.rows[0];
  s.bank = parseFloat(s.bank);
  s.prize_pool = parseFloat(s.prize_pool);
  s.commission_amount = parseFloat(s.commission_amount);
  s.drum_speeds = s.drum_speeds ? s.drum_speeds.map((x: string) => parseFloat(x)) : [];
  return s;
}

export async function createDailySafe() {
  const today = todayMSK();
  const exists = await query('SELECT id FROM safes WHERE date = $1', [today]);
  if (exists.rows.length) return;

  const code = [0, 1, 2].map(() => Math.floor(Math.random() * 10));
  const drumSpeeds = [0, 1, 2].map(() => +(1.5 + Math.random() * 2.5).toFixed(2));

  await query(
    `INSERT INTO safes (date, status, bonus, code, drum_speeds)
     VALUES ($1, 'collecting', false, $2, $3)`,
    [today, code, drumSpeeds]
  );
}

export async function safeDeposit(userId: number, amount: number) {
  const safe = await getTodaySafe();
  if (!safe) throw new Error('Сейф не создан');
  const user = await getUser(userId);
  if (!user) throw new Error('Пользователь не найден');

  const minBet = parseFloat(await getSetting('min_bet') || '1');
  if (amount < minBet) throw new Error(`Минимум $${minBet}`);
  const available = await getAvailableBalance(userId);
  if (amount > available) throw new Error('Недостаточно средств');
  if (safe.status !== 'collecting') throw new Error('Сейф закрыт');

  // Если у пользователя уже есть вклад, добавляем к нему
  const existingRes = await query(
    'SELECT id, amount FROM safe_deposits WHERE safe_id = $1 AND user_id = $2',
    [safe.id, userId]
  );

  const commPercent = 10;
  const commission = Math.round(amount * (commPercent / 100) * 100) / 100;
  const toSafe = Math.round((amount - commission) * 100) / 100;

  await modifyBalance(userId, -amount, 'bet', { gameType: 'safe' });
  await query(
    `UPDATE safes
     SET bank = bank + $1, prize_pool = prize_pool + $2,
         commission_amount = commission_amount + $3,
         participants_count = participants_count + CASE WHEN $4::boolean THEN 1 ELSE 0 END
     WHERE id = $5`,
    [amount, toSafe, commission, existingRes.rows.length === 0, safe.id]
  );

  if (existingRes.rows.length) {
    await query(
      'UPDATE safe_deposits SET amount = amount + $1 WHERE id = $2',
      [amount, existingRes.rows[0].id]
    );
  } else {
    await query(
      'INSERT INTO safe_deposits (safe_id, user_id, amount) VALUES ($1, $2, $3)',
      [safe.id, userId, amount]
    );
  }

  // Комиссия распределяется
  const refPercent = parseInt(await getSetting('referral_percent') || '3');
  const refCut = Math.round(amount * (refPercent / 100) * 100) / 100;
  let platformCut = commission;
  if (user.referred_by) {
    await modifyBalance(user.referred_by, refCut, 'referral', {
      gameType: 'safe', description: `3% от вклада в Сейф $${amount}`
    });
    platformCut = Math.round((commission - refCut) * 100) / 100;
  }
  await logPlatformRevenue(platformCut, 'safe');

  // Получить итоговый вклад пользователя
  const depositRes = await query(
    'SELECT amount FROM safe_deposits WHERE safe_id = $1 AND user_id = $2',
    [safe.id, userId]
  );
  const totalDeposit = parseFloat(depositRes.rows[0].amount);

  return {
    prize_if_win: Math.round(totalDeposit * 1.5 * 100) / 100,
    total_deposit: totalDeposit,
    bonus: safe.bonus
  };
}

export async function cancelSafeDeposit(userId: number) {
  const safe = await getTodaySafe();
  if (!safe) throw new Error('Сейф не найден');
  if (safe.status !== 'collecting') throw new Error('Сейф уже закрыт');

  const depRes = await query(
    'SELECT * FROM safe_deposits WHERE safe_id = $1 AND user_id = $2',
    [safe.id, userId]
  );
  if (!depRes.rows.length) throw new Error('Нет вклада');

  const dep = depRes.rows[0];
  const amount = parseFloat(dep.amount);

  const commPercent = 0.10;
  const depositedPrizeShare = Math.round(amount * (1 - commPercent) * 100) / 100;

  await modifyBalance(userId, amount, 'safe_cancel', { gameType: 'safe' });
  await query(
    `UPDATE safes SET bank = bank - $1, prize_pool = prize_pool - $2,
     commission_amount = commission_amount - $3,
     participants_count = participants_count - 1 WHERE id = $4`,
    [amount, depositedPrizeShare, Math.round(amount * commPercent * 100) / 100, safe.id]
  );
  await query('DELETE FROM safe_deposits WHERE id = $1', [dep.id]);

  return { returned: amount };
}

export async function submitCrackTime(userId: number, timeMs: number) {
  if (timeMs < 500) throw new Error('Слишком быстро');
  if (timeMs > 30000) throw new Error('Таймаут');
  const safe = await getTodaySafe();
  if (!safe) throw new Error('Сейф не найден');
  if (safe.status !== 'cracking') throw new Error('Не фаза взлома');

  // Проверка: пользователь имеет вклад?
  const depRes = await query(
    'SELECT * FROM safe_deposits WHERE safe_id = $1 AND user_id = $2',
    [safe.id, userId]
  );
  if (!depRes.rows.length) throw new Error('Нет вклада');

  await query(
    'UPDATE safe_deposits SET crack_time_ms = $1 WHERE id = $2',
    [Math.round(timeMs), depRes.rows[0].id]
  );
  return { recorded: true };
}

export async function calculateSafeWinners(safeId: number) {
  const safe = await getSafeById(safeId);
  if (!safe) return;
  if (safe.status !== 'cracking') return;

  const depRes = await query(
    `SELECT d.*, u.username
     FROM safe_deposits d
     JOIN users u ON u.id = d.user_id
     WHERE d.safe_id = $1
     ORDER BY d.crack_time_ms NULLS LAST`,
    [safeId]
  );

  let remaining = safe.prize_pool;
  let winners = 0;

  for (const d of depRes.rows) {
    if (d.crack_time_ms == null || d.crack_time_ms < 100) {
      await query('UPDATE safe_deposits SET prize = 0 WHERE id = $1', [d.id]);
      continue;
    }
    const amount = parseFloat(d.amount);
    const needed = Math.round(amount * 1.5 * 100) / 100;
    if (remaining >= needed - 0.01) {
      await query('UPDATE safe_deposits SET prize = $1 WHERE id = $2', [needed, d.id]);
      await modifyBalance(d.user_id, needed, 'win', {
        gameType: 'safe', gameId: safeId,
        description: 'Победа в Сейфе ×1.5'
      });
      remaining = Math.round((remaining - needed) * 100) / 100;
      winners += 1;
    } else if (remaining >= 0.01) {
      // Частичный приз из остатка пула
      const partial = Math.round(remaining * 100) / 100;
      await query('UPDATE safe_deposits SET prize = $1 WHERE id = $2', [partial, d.id]);
      await modifyBalance(d.user_id, partial, 'win', {
        gameType: 'safe', gameId: safeId,
        description: 'Частичный приз в Сейфе'
      });
      remaining = 0;
      winners += 1;
    } else {
      await query('UPDATE safe_deposits SET prize = 0 WHERE id = $1', [d.id]);
    }
  }

  await query(
    `UPDATE safes SET winners_count = $1, status = 'finished', cracked_at = NOW() WHERE id = $2`,
    [winners, safeId]
  );
}

export async function getSafeResults(safeId: number) {
  const depRes = await query(
    `SELECT d.*, u.username
     FROM safe_deposits d
     JOIN users u ON u.id = d.user_id
     WHERE d.safe_id = $1
     ORDER BY
       CASE WHEN d.crack_time_ms IS NULL OR d.crack_time_ms < 100 THEN 1 ELSE 0 END,
       d.crack_time_ms ASC NULLS LAST`,
    [safeId]
  );
  return depRes.rows.map(d => ({
    username: '@' + (d.username || 'user'),
    amount: parseFloat(d.amount),
    crack_time_ms: (d.crack_time_ms && d.crack_time_ms >= 100) ? d.crack_time_ms : null,
    prize: parseFloat(d.prize),
    user_id: d.user_id
  }));
}

export async function getUserSafeDeposit(safeId: number, userId: number) {
  const res = await query(
    'SELECT * FROM safe_deposits WHERE safe_id = $1 AND user_id = $2',
    [safeId, userId]
  );
  if (!res.rows.length) return null;
  const d = res.rows[0];
  return { ...d, amount: parseFloat(d.amount), prize: parseFloat(d.prize) };
}

export async function startCracking() {
  const safe = await getTodaySafe();
  if (!safe) return;
  const minBank = parseFloat(await getSetting('safe_min_bank') || '25');
  const minPart = parseInt(await getSetting('safe_min_participants') || '2');

  if (safe.bank < minBank || safe.participants_count < minPart) {
    // Вернуть депозиты
    await cancelSafeReturnDeposits(safe);
    return { cancelled: true };
  }
  await query("UPDATE safes SET status = 'cracking' WHERE id = $1", [safe.id]);
  return { cancelled: false, safe };
}

async function cancelSafeReturnDeposits(safe: any) {
  const depRes = await query('SELECT * FROM safe_deposits WHERE safe_id = $1', [safe.id]);
  for (const d of depRes.rows) {
    await modifyBalance(d.user_id, parseFloat(d.amount), 'safe_cancel', {
      gameType: 'safe', description: 'Сейф отменён (не набрал минимум)'
    });
  }
  await query("UPDATE safes SET status = 'cancelled' WHERE id = $1", [safe.id]);
}
