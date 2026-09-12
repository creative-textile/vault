import { query } from '../db/pool';
import { getUser, modifyBalance, getAvailableBalance } from './balance';
import { logPlatformRevenue, getSetting } from './revenue';
import { broadcast } from './notifications';
import { payReferral } from './referral';
import { todayMSK, tomorrowMSK } from '../utils/time';

/**
 * Запас времени после окончания окна взлома: даёт игрокам дослать результат
 * (сеть/лаг) и гарантирует, что финализация по расписанию не отрежет валидные
 * вводы. Входит в длину окна взлома, которое видит клиент.
 */
const CRACK_GRACE_MS = 10_000;

/** Таймеры финализации взлома по сейфам (пересоздаются после рестарта). */
const finalizeTimers = new Map<number, NodeJS.Timeout>();

/** Сколько минут длится фаза взлома (настройка safe_crack_timeout_minutes). */
async function getCrackTimeoutMs(): Promise<number> {
  const raw = parseInt(await getSetting('safe_crack_timeout_minutes') || '2');
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 2;
  return minutes * 60 * 1000;
}

/**
 * Полная длина окна взлома в мс (таймаут + запас). Именно столько длится
 * статус 'cracking' — по истечении окно закрывается и подводятся итоги.
 */
export async function getCrackWindowMs(): Promise<number> {
  return (await getCrackTimeoutMs()) + CRACK_GRACE_MS;
}

/** Привести строки из БД к числам (DECIMAL приходит строкой). */
function normalizeSafe(s: any) {
  s.bank = parseFloat(s.bank);
  s.prize_pool = parseFloat(s.prize_pool);
  s.commission_amount = parseFloat(s.commission_amount);
  s.drum_speeds = s.drum_speeds ? s.drum_speeds.map((x: string) => parseFloat(x)) : [];
  return s;
}

export async function getTodaySafe() {
  const today = todayMSK();
  const res = await query('SELECT * FROM safes WHERE date = $1', [today]);
  if (res.rows.length === 0) return null;
  return normalizeSafe(res.rows[0]);
}

export async function getSafeById(id: number) {
  const res = await query('SELECT * FROM safes WHERE id = $1', [id]);
  if (res.rows.length === 0) return null;
  return normalizeSafe(res.rows[0]);
}

/**
 * Сейф, который сейчас показывает экран «Сейф»/«Взлом».
 * Во время взлома возвращаем именно взламываемый сейф: окно взлома может
 * переходить полночь МСК, и тогда «сегодняшний» сейф — уже следующий,
 * а игроки всё ещё доигрывают вчерашний.
 */
export async function getActiveSafe() {
  const res = await query(
    `SELECT * FROM safes WHERE status = 'cracking' ORDER BY id DESC LIMIT 1`
  );
  if (res.rows.length) return normalizeSafe(res.rows[0]);
  return getTodaySafe();
}

export async function createDailySafe() {
  const today = todayMSK();
  const exists = await query('SELECT id FROM safes WHERE date = $1', [today]);
  if (exists.rows.length) return;

  // Получаем одинаковые цифры для всех игроков в этот день
  const code = [0, 1, 2].map(() => Math.floor(Math.random() * 10));
  const drumSpeeds = [0, 1, 2].map(() => +(1.5 + Math.random() * 2.5).toFixed(2));

  await query(
    `INSERT INTO safes (date, status, bonus, code, drum_speeds)
     VALUES ($1, 'collecting', false, $2, $3)`,
    [today, code, drumSpeeds]
  );
  console.log(`[SAFE] Создан дневной сейф с кодом: ${code.join(',')}`);
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
  const clientMs = Math.round(Number(timeMs));
  if (!Number.isFinite(clientMs)) throw new Error('Некорректное время');

  const safe = await getActiveSafe();
  if (!safe) throw new Error('Сейф не найден');
  if (safe.status !== 'cracking') throw new Error('Не фаза взлома');

  const windowMs = await getCrackWindowMs();

  // Сколько времени реально прошло с начала взлома (по серверным часам).
  // Защита от подкрутки клиентского времени и от ввода после закрытия окна.
  const startedAt = await getCrackStartedAt(safe.id);
  const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt.getTime()) : 0;
  if (elapsedMs > windowMs) throw new Error('Окно взлома закрыто');

  const timeoutMinutes = Math.round((await getCrackTimeoutMs()) / 60000);
  // Клиент считает время от старта барабанов, сервер — от старта фазы взлома,
  // поэтому берём большее из двух значений (честный порядок "кто раньше").
  const recordedMs = Math.max(clientMs, elapsedMs);
  if (recordedMs < 500) throw new Error('Слишком быстро');
  if (recordedMs > windowMs) throw new Error(`Таймаут: ${timeoutMinutes} мин`);

  // Проверка: пользователь имеет вклад?
  const depRes = await query(
    'SELECT * FROM safe_deposits WHERE safe_id = $1 AND user_id = $2',
    [safe.id, userId]
  );
  if (!depRes.rows.length) throw new Error('Нет вклада');

  await query(
    'UPDATE safe_deposits SET crack_time_ms = $1 WHERE id = $2',
    [recordedMs, depRes.rows[0].id]
  );
  return { recorded: true, crack_time_ms: recordedMs };
}

/** Момент старта фазы взлома (TIMESTAMPTZ → Date) или null, если отметки нет. */
async function getCrackStartedAt(safeId: number): Promise<Date | null> {
  const res = await query(`SELECT crack_started_at FROM safes WHERE id = $1`, [safeId]);
  if (!res.rows.length || !res.rows[0].crack_started_at) return null;
  const d = new Date(res.rows[0].crack_started_at);
  return isNaN(d.getTime()) ? null : d;
}

/** Сколько миллисекунд осталось до закрытия окна взлома (null, если отметки старта нет). */
export async function getCrackRemainingMs(safeId: number, windowMs?: number): Promise<number | null> {
  const started = await getCrackStartedAt(safeId);
  if (!started) return null;
  const win = windowMs ?? (await getCrackWindowMs());
  return Math.max(0, Math.round(win - (Date.now() - started.getTime())));
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

/** Гарантировать, что сейф следующего дня существует (чтобы депозиты не терялись). */
export async function ensureNextDaySafe(): Promise<void> {
  const tomorrow = tomorrowMSK();
  const nextSafeExists = await query('SELECT id FROM safes WHERE date = $1', [tomorrow]);
  if (nextSafeExists.rows.length) return;

  const code = [0, 1, 2].map(() => Math.floor(Math.random() * 10));
  const drumSpeeds = [0, 1, 2].map(() => +(1.5 + Math.random() * 2.5).toFixed(2));

  await query(
    `INSERT INTO safes (date, status, bonus, code, drum_speeds)
     VALUES ($1, 'collecting', false, $2, $3)`,
    [tomorrow, code, drumSpeeds]
  );
  console.log(`[SAFE] Создан сейф на ${tomorrow} (сбор следующего дня)`);
  broadcast('safe_created', { date: tomorrow });
}

/** Поставить таймер финализации взлома (снимает предыдущий, если был). */
function scheduleCrackFinalize(safeId: number, delayMs: number) {
  const prev = finalizeTimers.get(safeId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    finalizeTimers.delete(safeId);
    finalizeCracking(safeId).catch(e => console.error('[SAFE] Ошибка финализации взлома:', e.message));
  }, Math.max(0, delayMs));
  finalizeTimers.set(safeId, timer);
}

/**
 * Закрыть окно взлома: подвести итоги и раздать призы.
 * Идемпотентно — повторный вызов для уже разыгранного сейфа ничего не делает.
 */
export async function finalizeCracking(safeId?: number): Promise<number | null> {
  const id = safeId ?? (await getActiveSafe())?.id;
  if (!id) return null;
  const safe = await getSafeById(id);
  if (!safe || safe.status !== 'cracking') return null;

  const timer = finalizeTimers.get(id);
  if (timer) { clearTimeout(timer); finalizeTimers.delete(id); }

  await calculateSafeWinners(id);
  const finished = await getSafeById(id);
  if (!finished || finished.status !== 'finished') return null;

  broadcast('safe_finished', { safe_id: id });
  await ensureNextDaySafe();
  console.log(`[SAFE] Взлом сейфа #${id} завершён, победителей: ${finished.winners_count}`);
  return id;
}

/**
 * Страховка: завершить взлом, если окно истекло, а таймер был утерян
 * (рестарт процесса, пропущенный тик cron). Вызывается cron каждую минуту.
 */
export async function finalizeCrackIfDue(): Promise<number | null> {
  // У записей, созданных до появления crack_started_at, отметки нет — проставляем её,
  // иначе такой взлом закрылся бы мгновенно.
  await query(
    `UPDATE safes SET crack_started_at = NOW() WHERE status = 'cracking' AND crack_started_at IS NULL`
  );
  const windowMs = await getCrackWindowMs();
  const res = await query(
    `SELECT id, crack_started_at FROM safes WHERE status = 'cracking' ORDER BY id ASC`
  );
  for (const row of res.rows) {
    const started = row.crack_started_at ? new Date(row.crack_started_at) : null;
    if (!started || Date.now() - started.getTime() < windowMs) continue;
    const done = await finalizeCracking(row.id);
    if (done) return done;
  }
  return null;
}

/**
 * Восстановление после рестарта: у сейфов в статусе 'cracking' восстанавливаем
 * отметку старта (если её нет) и заново ставим таймер финализации.
 */
export async function resumeCracking(): Promise<void> {
  await query(
    `UPDATE safes SET crack_started_at = NOW() WHERE status = 'cracking' AND crack_started_at IS NULL`
  );
  const windowMs = await getCrackWindowMs();
  const res = await query(`SELECT id FROM safes WHERE status = 'cracking'`);
  for (const row of res.rows) {
    const remaining = await getCrackRemainingMs(row.id, windowMs);
    if (remaining == null || remaining <= 0) {
      await finalizeCracking(row.id);
    } else {
      scheduleCrackFinalize(row.id, remaining);
      console.log(`[SAFE] Взлом сейфа #${row.id} продолжается, осталось ${Math.round(remaining / 1000)} с`);
    }
  }
}

export async function startCracking() {
  const safe = await getTodaySafe();
  if (!safe) return;

  // Взлом уже идёт — не начинаем заново, только восстанавливаем таймер финализации
  if (safe.status === 'cracking') {
    const remaining = await getCrackRemainingMs(safe.id);
    if (remaining != null && remaining > 0) scheduleCrackFinalize(safe.id, remaining);
    return { cancelled: false, started: false, safe };
  }
  if (safe.status !== 'collecting') return { cancelled: false, started: false };

  const minBank = parseFloat(await getSetting('safe_min_bank') || '25');
  const minPart = parseInt(await getSetting('safe_min_participants') || '2');

  if (safe.bank < minBank || safe.participants_count < minPart) {
    // Вернуть депозиты
    await cancelSafeReturnDeposits(safe);
    await ensureNextDaySafe();
    return { cancelled: true, started: false };
  }

  // Перед началом взлома создаём сейф на следующий день, чтобы депозиты не терялись
  await ensureNextDaySafe();

  const windowMs = await getCrackWindowMs();
  const upd = await query(
    `UPDATE safes SET status = 'cracking', crack_started_at = NOW()
      WHERE id = $1 AND status = 'collecting'
      RETURNING *`,
    [safe.id]
  );
  if (!upd.rows.length) return { cancelled: false, started: false };

  // Итоги подводим по окончании окна взлома, а не сразу: у игроков должно быть
  // время пройти мини-игру и отправить результат.
  scheduleCrackFinalize(safe.id, windowMs);
  console.log(`[SAFE] Взлом сейфа #${safe.id} стартовал, окно ${Math.round(windowMs / 1000)} с`);

  return { cancelled: false, started: true, safe: (await getSafeById(safe.id)), window_ms: windowMs };
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
