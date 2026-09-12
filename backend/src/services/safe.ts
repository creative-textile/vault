import { query } from '../db/pool';
import { getUser, modifyBalance, getAvailableBalance } from './balance';
import { logPlatformRevenue, getSetting } from './revenue';
import { broadcast } from './notifications';
import { payReferral } from './referral';
import { todayMSK } from '../utils/time';

/**
 * Технологический допуск ПОСЛЕ окна взлома: результат, отправленный игроком до
 * закрытия окна, но доехавший до сервера с задержкой, всё ещё засчитывается.
 * На клиенте не показывается — игрок видит ровно safe_crack_timeout_minutes.
 */
const CRACK_GRACE_MS = 5_000;

/**
 * ОБЩИЙ старт вращения барабанов: через сколько миллисекунд после начала окна
 * взлома мини-игра стартует ОДНОВРЕМЕННО у всех игроков.
 *
 * Без этого каждый клиент запускал отсчёт 3-2-1 от момента собственного
 * монтирования экрана (а монтируется он в разное время: кого-то выдернуло сразу
 * по socket-событию, кого-то — на секунду позже из полёта ракеты), и один игрок
 * уже вводил шифр, пока другой досматривал «3…2…1». Теперь момент старта —
 * абсолютная величина от серверных часов, клиент её только пересчитывает в свои.
 */
const SPIN_LEAD_MS = 6_000;

/** За сколько мс до общего старта показываем код (крупный отсчёт 3-2-1). */
export const SPIN_CODE_LEAD_MS = 3_000;

/**
 * Скорость барабана определяет, сколько миллисекунд видна каждая цифра:
 *     время цифры = 1000 / (speed × 1.3) мс
 * Диапазон 1.45–2.00 → 385–530 мс на цифру. Это калибровано под живого
 * игрока: простая зрительная реакция ~250–300 мс, поэтому обычный игрок
 * попадает примерно в 80% попыток, а опытный (ловит ритм заранее) — чаще.
 * Разброс между игроками при этом остаётся в десятках миллисекунд —
 * порядок сдачи результата по-прежнему решает, кто заберёт пул.
 */
const DRUM_SPEED_MIN = 1.45;
const DRUM_SPEED_MAX = 2.0;
const DRUM_SPEED_FALLBACK = [1.55, 1.72, 1.9];

/** Скорости на день: три разных значения, чтобы барабаны не синхронизировались. */
export function generateDrumSpeeds(): number[] {
  const base = 1.5 + Math.random() * 0.15;
  return [
    base,
    base + 0.13 + Math.random() * 0.07,
    base + 0.26 + Math.random() * 0.1
  ].map(v => +v.toFixed(2));
}

/**
 * Привести скорости к игровому диапазону. Сейфы, созданные до настройки,
 * могли получить 1.5–4.0 (цифра мелькала 190 мс — попасть почти невозможно).
 */
export function clampDrumSpeeds(speeds: any): number[] {
  if (!Array.isArray(speeds) || speeds.length !== 3) return [...DRUM_SPEED_FALLBACK];
  const nums = speeds.map((x: any) => parseFloat(x));
  if (nums.some((n: number) => !Number.isFinite(n) || n < DRUM_SPEED_MIN || n > DRUM_SPEED_MAX)) {
    return [...DRUM_SPEED_FALLBACK];
  }
  return nums;
}

/**
 * Цифра, которую видно на барабане в момент ms от старта вращения.
 * Формула ЕДИНАЯ для клиента и сервера: клиент по ней рисует и проверяет тап,
 * сервер — перепроверяет присланные моменты тапов по коду сейфа.
 */
export function digitAt(speed: number, ms: number): number {
  return Math.floor((ms * speed * 0.0013) % 10);
}

/** Таймеры финализации взлома по сейфам (пересоздаются после рестарта). */
const finalizeTimers = new Map<number, NodeJS.Timeout>();

/**
 * Сейфы, итоги которых подводятся прямо сейчас. Защита от гонки: два игрока
 * могут сдать результат практически одновременно и оба увидеть «все сдали».
 */
const finalizingSafes = new Set<number>();

/** Сколько минут длится фаза взлома (настройка safe_crack_timeout_minutes). */
async function getCrackTimeoutMs(): Promise<number> {
  const raw = parseInt(await getSetting('safe_crack_timeout_minutes') || '1');
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 1;
  return minutes * 60 * 1000;
}

/**
 * Длина окна взлома в мс — ровно safe_crack_timeout_minutes.
 * Столько времени даётся всем игрокам и столько видит клиент на обратном отсчёте.
 */
export async function getCrackWindowMs(): Promise<number> {
  return await getCrackTimeoutMs();
}

/** Когда окно реально закрывается (окно + допуск на доставку результата). */
async function getCrackDeadlineMs(): Promise<number> {
  return (await getCrackWindowMs()) + CRACK_GRACE_MS;
}

/** Привести строки из БД к числам (DECIMAL приходит строкой). */
function normalizeSafe(s: any) {
  s.bank = parseFloat(s.bank);
  s.prize_pool = parseFloat(s.prize_pool);
  s.commission_amount = parseFloat(s.commission_amount);
  s.drum_speeds = clampDrumSpeeds(s.drum_speeds);
  return s;
}

/**
 * 'YYYY-MM-DD' из того, что вернул pg для колонки DATE.
 *
 * pg при TZ впереди UTC (в контейнере TZ=Europe/Moscow) отдаёт DATE как
 * Date в ЛОКАЛЬНОЙ полночи, поэтому toISOString() сдвигает дату на день
 * назад. Берём локальные компоненты — так дата не «теряется».
 */
export function toDateStr(v: any, fallback: string): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return fallback;
}

/**
 * Дата следующего сейфа: «максимальная дата в таблице + 1 день», но не раньше
 * сегодняшней (иначе после простоя сервера сейф создался бы в прошлом и клиенты
 * его бы не увидели — они берут date >= сегодня). Арифметика чисто строковая,
 * без Date: см. toDateStr().
 */
export function nextSafeDate(maxDate: any, today: string): string {
  const [y, m, d] = toDateStr(maxDate, today).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return next > today ? next : today;
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

/**
 * Сейф, который сейчас принимает вклады.
 * Как только дневной сейф ушёл во взлом или уже разыгран, сбор продолжается
 * на сейф следующего дня (он создаётся в момент старта взлома). Поэтому ни
 * ручной вклад, ни автовклад с выигрыша никогда не блокируются фазой взлома.
 */
export async function getCollectingSafe() {
  const findCollecting = () => query(
    `SELECT * FROM safes
      WHERE status = 'collecting' AND date >= CAST($1 AS DATE)
      ORDER BY date ASC LIMIT 1`,
    [todayMSK()]
  );

  let res = await findCollecting();
  if (res.rows.length) return normalizeSafe(res.rows[0]);

  // Собирающего сейфа нет (например, дневной только что ушёл во взлом,
  // а сейф следующего дня ещё не создан) — создаём и берём его.
  await ensureNextDaySafe();
  res = await findCollecting();
  if (!res.rows.length) {
    console.error('[SAFE] Собирающий сейф не создан — вклады принимать некуда');
    return null;
  }
  return normalizeSafe(res.rows[0]);
}

/**
 * Собирающий сейф без создания нового (для планировщика):
 * возвращает null, если сейчас никто не собирает.
 */
export async function getCollectingSafeOrNull() {
  const res = await query(
    `SELECT * FROM safes
      WHERE status = 'collecting' AND date >= CAST($1 AS DATE)
      ORDER BY date ASC LIMIT 1`,
    [todayMSK()]
  );
  return res.rows.length ? normalizeSafe(res.rows[0]) : null;
}

/**
 * Последний завершённый раунд (взломан или отменён) — тот, чьи итоги
 * показывает экран сейфа. Вся история раундов в БД остаётся, но клиенту
 * отдаётся только последний: игроку достаточно увидеть свой результат один раз.
 */
export async function getLastFinishedSafe() {
  const res = await query(
    `SELECT * FROM safes
      WHERE status <> 'collecting' AND status <> 'cracking'
      ORDER BY id DESC LIMIT 1`
  );
  return res.rows.length ? normalizeSafe(res.rows[0]) : null;
}

/**
 * Когда сейф начал собирать вклады.
 * Основное значение — колонка collect_started_at; если её нет (старая строка),
 * берём момент взлома предыдущего сейфа: сбор следующего начинается именно тогда.
 */
export async function getCollectStartedAt(safeId: number): Promise<Date | null> {
  const own = await query('SELECT collect_started_at FROM safes WHERE id = $1', [safeId]);
  if (own.rows.length && own.rows[0].collect_started_at) return new Date(own.rows[0].collect_started_at);
  const prev = await query('SELECT MAX(crack_started_at) AS prev FROM safes WHERE id < $1', [safeId]);
  if (prev.rows.length && prev.rows[0].prev) return new Date(prev.rows[0].prev);
  return null;
}

export async function createDailySafe() {
  const today = todayMSK();
  const exists = await query('SELECT id FROM safes WHERE date = $1', [today]);
  if (exists.rows.length) return;
  // Сбор уже идёт в сейфе другой даты (такое бывает при переносе времени взлома
  // в админке) — второй параллельный сейф не создаём
  const collecting = await query(`SELECT id FROM safes WHERE status = 'collecting' LIMIT 1`);
  if (collecting.rows.length) return;

  // Получаем одинаковые цифры для всех игроков в этот день
  const code = [0, 1, 2].map(() => Math.floor(Math.random() * 10));
  const drumSpeeds = generateDrumSpeeds();

  await query(
    `INSERT INTO safes (date, status, bonus, code, drum_speeds, collect_started_at)
     VALUES ($1, 'collecting', false, $2, $3, NOW())`,
    [today, code, drumSpeeds]
  );
  console.log(`[SAFE] Создан дневной сейф с кодом: ${code.join(',')}`);
}

export async function safeDeposit(userId: number, amount: number) {
  // Вклад всегда идёт в сейф, который сейчас собирает: во время взлома
  // сегодняшнего это сейф следующего дня (иначе деньги «зависали» бы до полуночи).
  const safe = await getCollectingSafe();
  if (!safe) throw new Error('Сейф не создан');
  const user = await getUser(userId);
  if (!user) throw new Error('Пользователь не найден');

  const minBet = parseFloat(await getSetting('min_bet') || '1');
  if (amount < minBet) throw new Error(`Минимум $${minBet}`);
  const available = await getAvailableBalance(userId);
  if (amount > available) throw new Error('Недостаточно средств');

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

  // Банк на главном экране должен обновляться у всех без перезагрузки страницы
  const updated = await getSafeById(safe.id);
  if (updated) {
    broadcast('safe_deposit', {
      safe_id: updated.id,
      bank: updated.bank,
      prize_pool: updated.prize_pool,
      participants_count: updated.participants_count
    });
  }

  return {
    safe_id: safe.id,
    prize_if_win: Math.round(totalDeposit * 1.5 * 100) / 100,
    total_deposit: totalDeposit,
    bonus: safe.bonus
  };
}

export async function cancelSafeDeposit(userId: number) {
  const safe = await getCollectingSafe();
  if (!safe) throw new Error('Сейф не найден');

  const depRes = await query(
    'SELECT * FROM safe_deposits WHERE safe_id = $1 AND user_id = $2',
    [safe.id, userId]
  );
  if (!depRes.rows.length) {
    // Вклад может лежать в сейфе, который уже ушёл во взлом, — вернуть его нельзя
    throw new Error(`Нет вклада в СЕЙФ #${safe.id} (возврат доступен только до начала взлома)`);
  }

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

  const updated = await getSafeById(safe.id);
  if (updated) {
    broadcast('safe_deposit', {
      safe_id: updated.id,
      bank: updated.bank,
      prize_pool: updated.prize_pool,
      participants_count: updated.participants_count
    });
  }

  return { returned: amount, safe_id: safe.id };
}

/**
 * Принять результат взлома.
 * Клиент присылает не только время, но и моменты тапов по барабанам (мс от
 * старта вращения). Сервер сам считает, какие цифры были видны в эти моменты,
 * и сверяет их с кодом сейфа: подставить произвольные числа не выйдет —
 * несовпавшие цифры означают отклонённый результат (игрок пробует снова),
 * а засчитанное время никогда не может оказаться лучше честно пересчитанного.
 * Штрафного времени за промах нет: промах и так стоит повторного тапа.
 */
export async function submitCrackTime(userId: number, timeMs: number, taps?: any) {
  const clientMs = Math.round(Number(timeMs));
  if (!Number.isFinite(clientMs)) throw new Error('Некорректное время');

  const safe = await getActiveSafe();
  if (!safe) throw new Error('Сейф не найден');
  if (safe.status !== 'cracking') throw new Error('Не фаза взлома');

  // Проверка: пользователь имеет вклад?
  const depRes = await query(
    'SELECT * FROM safe_deposits WHERE safe_id = $1 AND user_id = $2',
    [safe.id, userId]
  );
  if (!depRes.rows.length) {
    // Вклад может лежать в сейфе, который уже ушёл во взлом, — вернуть его нельзя
    throw new Error(`Нет вклада в СЕЙФ #${safe.id} (возврат доступен только до начала взлома)`);
  }

  // Результат уже засчитан — повторная отправка его не перезаписывает
  // (иначе повторный заход на экран взлома ухудшил бы честное время).
  if (depRes.rows[0].crack_time_ms != null) {
    const recorded = depRes.rows[0].crack_time_ms;
    return { recorded: true, already_recorded: true, crack_time_ms: recorded, finished: false };
  }

  const deadlineMs = await getCrackDeadlineMs();

  // Сколько времени реально прошло с начала взлома (по серверным часам).
  // Защита от подкрутки клиентского времени и от ввода после закрытия окна.
  const startedAt = await getCrackStartedAt(safe.id);
  const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt.getTime()) : 0;
  if (elapsedMs > deadlineMs) throw new Error('Окно взлома закрыто');

  const timeoutMinutes = Math.round((await getCrackTimeoutMs()) / 60000);

  // ── Проверка кода по тапам (сервер не верит заявленному времени на слово) ──
  const speeds = Array.isArray(safe.drum_speeds) && safe.drum_speeds.length === 3 ? safe.drum_speeds : null;
  const code = Array.isArray(safe.code) ? safe.code.map((c: any) => Number(c)) : null;
  const tapList = Array.isArray(taps) ? taps.map((x: any) => Math.round(Number(x))) : null;
  let verifiedMs = 0;
  const tapsOk = !!speeds && !!code && code.length === 3 && !!tapList && tapList.length === 3
    && tapList.every((t: number) => Number.isFinite(t) && t >= 0 && t <= 24 * 3600 * 1000);
  if (tapsOk) {
    const mismatched = tapList!.filter((t: number, i: number) => digitAt(speeds![i], t) !== code![i]);
    if (mismatched.length) {
      // Клиент остановил барабаны не на цифрах кода — такой результат не принимается.
      // Штрафа нет: промах и так стоит игроку времени (барабан крутится дальше).
      console.log(`[SAFE] user ${userId}: тапы не совпали с кодом (${mismatched.length}/3) — результат отклонён`);
      throw new Error('Цифры не совпадают с кодом сейфа');
    }
    verifiedMs = Math.max(...tapList!);
  } else if (Array.isArray(taps)) {
    console.log(`[SAFE] user ${userId}: прислан некорректный список тапов — считаем только время клиента`);
  }
  // Заявленное клиентом время не может быть лучше пересчитанного сервером.
  // Штрафы за промахи не начисляются: промахнувшемуся игроку приходится тапать
  // снова, и он теряет время сам.
  const honestMs = Math.max(clientMs, verifiedMs);

  // Клиент считает время от старта барабанов, сервер — от старта фазы взлома,
  // поэтому берём большее из двух значений (честный порядок "кто раньше").
  const recordedMs = Math.max(honestMs, elapsedMs);
  if (recordedMs < 500) throw new Error('Слишком быстро');
  if (recordedMs > deadlineMs) throw new Error(`Таймаут: ${timeoutMinutes} мин`);

  await query(
    'UPDATE safe_deposits SET crack_time_ms = $1 WHERE id = $2',
    [recordedMs, depRes.rows[0].id]
  );

  // Окно взлома — это крайний срок для тех, кто ушёл от компьютера.
  // Как только ВСЕ участники сдали результат, подводим итоги сразу,
  // не заставляя игроков ждать оставшиеся минуты.
  const waiting = await getPendingCracksCount(safe.id);
  const finished = waiting === 0 ? !!(await finalizeCracking(safe.id)) : false;
  if (finished) console.log(`[SAFE] Все участники сдали результат — итоги подведены досрочно`);

  return { recorded: true, crack_time_ms: recordedMs, waiting, finished };
}

/** Остаток до фактического закрытия окна (окно + допуск) — для таймеров финализации. */
async function getDeadlineRemainingMs(safeId: number): Promise<number | null> {
  return getCrackRemainingMs(safeId, await getCrackDeadlineMs());
}

/** Сколько участников взлома ещё не сдали результат (для «ждём остальных»). */
export async function getPendingCracksCount(safeId: number): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int AS n FROM safe_deposits WHERE safe_id = $1 AND crack_time_ms IS NULL`,
    [safeId]
  );
  return res.rows.length ? res.rows[0].n : 0;
}

/** Момент старта фазы взлома (TIMESTAMPTZ → Date) или null, если отметки нет. */
async function getCrackStartedAt(safeId: number): Promise<Date | null> {
  const res = await query(`SELECT crack_started_at FROM safes WHERE id = $1`, [safeId]);
  if (!res.rows.length || !res.rows[0].crack_started_at) return null;
  const d = new Date(res.rows[0].crack_started_at);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Сколько миллисекунд осталось до конца окна взлома (null, если отметки старта нет).
 * Это значение уходит клиенту: оно равно ровно safe_crack_timeout_minutes в момент старта.
 * Для таймеров финализации используйте getDeadlineRemainingMs() (окно + допуск).
 */
export async function getCrackRemainingMs(safeId: number, windowMs?: number): Promise<number | null> {
  const started = await getCrackStartedAt(safeId);
  if (!started) return null;
  const win = windowMs ?? (await getCrackWindowMs());
  return Math.max(0, Math.round(win - (Date.now() - started.getTime())));
}

/**
 * Длина «разгона» до общего старта: не больше SPIN_LEAD_MS и не больше 20% окна,
 * чтобы короткое окно взлома не съедалось церемонией.
 */
export async function getSpinLeadMs(windowMs?: number): Promise<number> {
  const win = windowMs ?? (await getCrackWindowMs());
  return Math.min(SPIN_LEAD_MS, Math.max(1_500, Math.round(win * 0.2)));
}

/**
 * Сколько миллисекунд осталось до ОБЩЕГО старта вращения. Значение считается от
 * серверных часов и потому одинаково для всех игроков в один и тот же момент;
 * отрицательное — общий старт уже прошёл (опоздавший игрок сразу попадает
 * на вращающиеся барабаны, а не на фейковый отсчёт).
 */
export async function getSpinStartInMs(safeId: number, windowMs?: number): Promise<number | null> {
  const started = await getCrackStartedAt(safeId);
  if (!started) return null;
  const lead = await getSpinLeadMs(windowMs);
  return Math.round(started.getTime() + lead - Date.now());
}

export async function calculateSafeWinners(safeId: number) {
  const safe = await getSafeById(safeId);
  if (!safe) return;
  if (safe.status !== 'cracking') return;

  // Атомарно «застолбить» розыгрыш: cracked_at проставляется один раз,
  // поэтому призыв из двух мест (таймер + досрочный по сдаче результата)
  // не выплатит призы дважды.
  const claim = await query(
    `UPDATE safes SET cracked_at = NOW()
      WHERE id = $1 AND status = 'cracking' AND cracked_at IS NULL
      RETURNING id`,
    [safeId]
  );
  if (!claim.rows.length) return;

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
    `UPDATE safes SET winners_count = $1, status = 'finished' WHERE id = $2`,
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

/**
 * Создать сейф, который будет собирать вклады следующим.
 *
 * Сейфы идут бесконечной чередой: как только текущий ушёл во взлом или
 * отменён, должен появиться новый собирающий. Дату берём как «максимальная
 * дата в таблице + 1 день» (date UNIQUE), потому что за день может быть
 * разыграно несколько раундов — например, если админ переносил время взлома:
 * сейф #2 при этом уже имеет дату завтрашнего дня, и «завтра» было бы занято.
 */
export async function ensureNextDaySafe(): Promise<void> {
  const today = todayMSK();

  // Сбор, который видят клиенты (date >= сегодня), — второй сейф не нужен
  const visible = await query(
    `SELECT id FROM safes WHERE status = 'collecting' AND date >= CAST($1 AS DATE) LIMIT 1`,
    [today]
  );
  if (visible.rows.length) return;

  const maxRes = await query(`SELECT MAX(date) AS max_date FROM safes`);
  const nextDate = nextSafeDate(maxRes.rows[0]?.max_date, today);

  // «Протухший» собирающий сейф (дата в прошлом — сервер долго не работал):
  // клиенты его не видят, а новый из-за него не создать. Переносим дату вперёд,
  // сохраняя уже внесённые вклады.
  const stale = await query(
    `SELECT id FROM safes WHERE status = 'collecting' AND date < CAST($1 AS DATE) ORDER BY date ASC LIMIT 1`,
    [today]
  );
  if (stale.rows.length) {
    await query(`UPDATE safes SET date = $1, collect_started_at = NOW() WHERE id = $2`, [nextDate, stale.rows[0].id]);
    console.log(`[SAFE] Сейф #${stale.rows[0].id} с просроченной датой перенесён на ${nextDate} (сбор продолжается)`);
    broadcast('safe_created', { date: nextDate });
    return;
  }

  const code = [0, 1, 2].map(() => Math.floor(Math.random() * 10));
  const drumSpeeds = generateDrumSpeeds();

  // DO NOTHING — два параллельных вклада не должны создавать два сейфа
  const ins = await query(
    `INSERT INTO safes (date, status, bonus, code, drum_speeds, collect_started_at)
     VALUES ($1, 'collecting', false, $2, $3, NOW())
     ON CONFLICT (date) DO NOTHING`,
    [nextDate, code, drumSpeeds]
  );
  if (!ins.rowCount) {
    // Сюда попадаем только если на nextDate уже есть сейф — иначе сбор встал бы
    console.log(`[SAFE] Сейф на ${nextDate} уже существует (status не collecting) — сбор недоступен, нужна проверка`);
    return;
  }
  console.log(`[SAFE] Создан сейф на ${nextDate} (сбор следующего раунда)`);
  broadcast('safe_created', { date: nextDate });
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
  // Занимаем сейф синхронно (без await между проверкой и отметкой),
  // иначе параллельный вызов успел бы пройти проверку тоже.
  if (finalizingSafes.has(id)) return null;
  finalizingSafes.add(id);
  try {
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
  } finally {
    finalizingSafes.delete(id);
  }
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
  const deadlineMs = await getCrackDeadlineMs();
  const res = await query(
    `SELECT id, crack_started_at FROM safes WHERE status = 'cracking' ORDER BY id ASC`
  );
  for (const row of res.rows) {
    const started = row.crack_started_at ? new Date(row.crack_started_at) : null;
    if (!started || Date.now() - started.getTime() < deadlineMs) continue;
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
  const res = await query(`SELECT id FROM safes WHERE status = 'cracking'`);
  for (const row of res.rows) {
    const remaining = await getDeadlineRemainingMs(row.id);
    if (remaining == null || remaining <= 0) {
      await finalizeCracking(row.id);
    } else {
      scheduleCrackFinalize(row.id, remaining);
      console.log(`[SAFE] Взлом сейфа #${row.id} продолжается, осталось ${Math.round(remaining / 1000)} с`);
    }
  }
}

export async function startCracking() {
  // Ломаем тот сейф, который сейчас собирает. Обычно это сейф сегодняшнего дня,
  // но после розыгрыша (или если админ перенёс время взлома) собирать может уже
  // сейф следующей даты — он и должен открыться в настроенное время.
  const safe = (await getCollectingSafeOrNull()) || (await getTodaySafe());
  if (!safe) return;

  // Взлом уже идёт — не начинаем заново, только восстанавливаем таймер финализации
  if (safe.status === 'cracking') {
    const remaining = await getDeadlineRemainingMs(safe.id);
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

  const windowMs = await getCrackWindowMs();
  const deadlineMs = await getCrackDeadlineMs();
  const upd = await query(
    `UPDATE safes SET status = 'cracking', crack_started_at = NOW()
      WHERE id = $1 AND status = 'collecting'
      RETURNING *`,
    [safe.id]
  );
  if (!upd.rows.length) return { cancelled: false, started: false };

  // Следующий сейф создаём ПОСЛЕ перевода текущего во взлом: сбор не должен
  // прерываться ни на минуту (иначе ensureNextDaySafe увидел бы «сбор идёт»)
  await ensureNextDaySafe();

  // Итоги подводим по окончании окна взлома, а не сразу: у игроков должно быть
  // время пройти мини-игру и отправить результат.
  scheduleCrackFinalize(safe.id, deadlineMs);
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
