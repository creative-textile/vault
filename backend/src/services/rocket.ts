import { query } from '../db/pool';
import { withTransaction } from '../db/pool';
import { getUser, modifyBalance, getAvailableBalance } from './balance';
import { logPlatformRevenue, getSetting } from './revenue';
import { payReferral } from './referral';
import { roundDownClean, CRASH_HARD_CAP } from '../config';
import { randomBytes } from 'crypto';

const FLIGHT_CURVE = 0.075;

export function getMultiplierAt(elapsedSec: number): number {
  return Math.exp(FLIGHT_CURVE * elapsedSec);
}

/**
 * Точка взрыва раунда.
 *
 * Ограничение сверху по кассе (`bankroll / bet`) не совпадает с ограничением
 * колонки: при кассе $10 000+ и ставке $1 значение уходило за потолок
 * DECIMAL(8,4) = 9999.9999, INSERT падал с `22003 numeric field overflow`, и
 * игрок получал ошибку вместо раунда (проверено на реальном PostgreSQL).
 * Колонка расширена до DECIMAL(12,4), а CRASH_HARD_CAP гарантирует, что сервис
 * не сгенерирует значение вне её диапазона.
 */
export function calculateCrashPoint(bet: number, bankroll: number, rng:()=>number = Math.random): number {
  // 1. Макс. по кассе
  const maxByBankroll = bankroll / bet;
  // 2. Случайная точка (10% house edge)
  const r = rng();
  const randomCrash = 0.90 / (1 - r);
  // 3. Защита кассы + защита от переполнения типа колонки
  let crash = Math.min(randomCrash, maxByBankroll, CRASH_HARD_CAP);
  crash = Math.round(crash * 100) / 100;
  return Math.max(crash, 1.01);
}

export function maybeBeautifulFlight(crashPoint: number, cashoutAt: number | null, chance = 3): number {
  if (cashoutAt == null) return crashPoint;
  if (Math.random() * 100 <= chance) {
    const beautiful = Math.round((20 + Math.random() * 60) * 100) / 100;
    if (beautiful > crashPoint) return beautiful;
  }
  return crashPoint;
}

export async function getRocketBankroll(): Promise<number> {
  const res = await query('SELECT amount FROM rocket_bankroll ORDER BY id LIMIT 1');
  return parseFloat(res.rows[0].amount);
}

/**
 * Лимиты ставки Ракеты.
 *
 * `rocket_max_bet_percent` — процент от кассы Ракеты:
 *   - **100 (по умолчанию)** — можно поставить всю кассу;
 *   - **больше 100** — ставка может превышать кассу (осознанный риск админа:
 *     точка взрыва в этом случае упирается в `bankroll / bet`, то есть раунд
 *     почти всегда заканчивается мгновенным падением);
 *   - **0** — лимита нет вовсе. `max_bet` возвращается как `null`, и клиент
 *     показывает «Макс: без лимита» вместо бессмысленного `$0`/`$Infinity`.
 *
 * Значение округляется серверным `roundDownClean()` (вниз до первой значащей
 * цифры), поэтому в ответе всегда «красивая» сумма: касса $2 470 и 100% →
 * $2 000, а не $2 470.
 */
export interface RocketLimits {
  min_bet: number;
  /** `null` — лимита нет. */
  max_bet: number | null;
  max_bet_percent: number;
  bankroll: number;
}

export async function getRocketLimits(bankrollOverride?: number): Promise<RocketLimits> {
  const [bankroll, maxRaw, minRaw] = await Promise.all([
    bankrollOverride == null ? getRocketBankroll() : Promise.resolve(bankrollOverride),
    getSetting('rocket_max_bet_percent'),
    getSetting('min_bet')
  ]);
  const percent = parseFloat(maxRaw || '100');
  const unlimited = !Number.isFinite(percent) || percent <= 0;
  const maxBet = unlimited ? null : roundDownClean(bankroll * (percent / 100));
  const minBet = parseFloat(minRaw || '1');
  return {
    min_bet: Number.isFinite(minBet) && minBet > 0 ? minBet : 1,
    max_bet: maxBet,
    max_bet_percent: unlimited ? 0 : percent,
    bankroll
  };
}

export async function updateRocketBankroll(delta: number) {
  const res=await query('UPDATE rocket_bankroll SET amount=amount+$1,updated_at=NOW() WHERE id=1 AND amount+$1 >= 0 RETURNING amount',[Math.round(delta*100)/100]);
  if (!res.rows.length) throw new Error('Недостаточно средств в кассе Ракеты');
}

async function placeBetImpl(userId: number, betAmount: number) {
  const user = await getUser(userId);
  if (!user) throw new Error('Пользователь не найден');

  const bankroll = await getRocketBankroll();
  const limits = await getRocketLimits(bankroll);
  const maxBet = limits.max_bet;
  const available = await getAvailableBalance(userId);

  const minBet = limits.min_bet;
  if (betAmount < minBet) throw new Error(`Минимальная ставка: $${minBet}`);
  if (Math.round(betAmount * 100) > Math.round(available * 100)) throw new Error('Недостаточно средств');
  // `max_bet === null` означает «лимита нет» (настройка 0%) — проверка не выполняется
  if (maxBet != null && betAmount > maxBet) {
    throw new Error(`Максимальная ставка: $${maxBet}`);
  }

  // Списать ставку
  await modifyBalance(userId, -betAmount, 'bet', { gameType: 'rocket' });

  const commissionPercent = parseFloat(await getSetting('commission_percent') || '10');
  const commission = Math.round(betAmount * (commissionPercent / 100) * 100) / 100;
  const toBankroll = betAmount - commission; // 90%
  const toReferrer = await payReferral(userId, betAmount, 'rocket'); // 3%
  const toPlatform = commission - toReferrer; // 7%

  await updateRocketBankroll(toBankroll);
  if (toPlatform > 0) {
    await logPlatformRevenue(toPlatform, 'rocket');
  }

  // Точка взрыва
  const crashAt = calculateCrashPoint(betAmount, bankroll + toBankroll);

  const replaySeed=randomBytes(16).toString('hex');
  const res = await query(
    `INSERT INTO rocket_rounds (user_id, bet, crash_at, flight_curve, replay_seed)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, crash_at`,
    [userId, betAmount, crashAt, FLIGHT_CURVE,replaySeed]
  );

  // `crash_at` в ответ НЕ отдаётся. Раньше сервер сообщал точку взрыва до
  // начала полёта, поэтому достаточно было открыть DevTools (или сделать тот
  // же запрос скриптом) и забирать выигрыш на x<crash_at всегда: преимущество
  // казино превращалось в гарантированный плюс игрока. Точка взрыва уходит
  // клиенту только вместе с событием `crash` (когда раунд уже завершён) и в
  // `cashout_result` — там она нужна лишь для анимации «призрака».
  return {
    round_id: res.rows[0].id,
    replay_seed: replaySeed,
    // `null` — лимита нет (настройка 0%): клиент рисует «Макс: без лимита»
    max_bet: maxBet,
    max_bet_unlimited: maxBet == null,
    min_bet: minBet,
    bankroll: Math.round((bankroll + toBankroll) * 100) / 100
  };
}

async function processCashoutImpl(roundId: number, userId: number, elapsedSec?: number) {
  const res = await query('SELECT * FROM rocket_rounds WHERE id = $1', [roundId]);
  if (res.rows.length === 0) throw new Error('Раунд не найден');
  const round = res.rows[0];
  if (Number(round.user_id) !== Number(userId)) throw new Error('Не ваш раунд');
  if (round.cashout_at) throw new Error('Уже забрали');

  // Время полёта берём из БД, а не из памяти процесса: `activeRounds` живёт на
  // том экземпляре backend, который запустил тики, поэтому при горизонтальном
  // масштабировании кэшаут на другом инстансе раньше просто терялся (раунд
  // оставался незакрытым, ставка сгорала без шанса забрать).
  let elapsed: number;
  if (Number.isFinite(elapsedSec) && (elapsedSec as number) >= 0) {
    elapsed = elapsedSec as number;
  } else {
    if (!round.tick_started_at) throw new Error('Раунд ещё не стартовал');
    elapsed = (Date.now() - new Date(round.tick_started_at).getTime()) / 1000;
  }
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Некорректное время полёта');
  const currentMult = getMultiplierAt(elapsed);
  if (currentMult >= parseFloat(round.crash_at)) {
    return { result: 'too_late' as const };
  }

  const bet = parseFloat(round.bet);
  const grossWin = Math.round(bet * currentMult * 100) / 100;

  // Атомарно занимаем раунд ДО выплаты. Проверка `round.cashout_at` отдельным
  // SELECT оставляла гонку: два одновременных «ЗАБРАТЬ» (двойной клик, бейдж
  // полёта и экран ракеты разом) проходили её оба и выплачивали выигрыш
  // дважды — деньги брались из воздуха. Заодно отметка сразу защищает раунд от
  // processCrash (`WHERE cashout_at IS NULL`), который иначе списал бы ставку
  // параллельно с выплатой.
  const claim = await query(
    `UPDATE rocket_rounds SET cashout_at = $1
      WHERE id = $2 AND user_id = $3 AND cashout_at IS NULL
      RETURNING id`,
    [currentMult, roundId, userId]
  );
  if (claim.rows.length === 0) throw new Error('Уже забрали');

  // Забрать из кассы
  await updateRocketBankroll(-grossWin);
  await modifyBalance(userId, grossWin, 'win', {
    gameType: 'rocket',
    gameId: roundId,
    description: `Выигрыш x${currentMult.toFixed(2)}`
  });

  // Красивый полёт
  const beautifulChance = parseInt(await getSetting('beautiful_flight_chance') || '3');
  let finalCrash = maybeBeautifulFlight(parseFloat(round.crash_at), currentMult, beautifulChance);
  if (finalCrash !== parseFloat(round.crash_at)) {
    await query('UPDATE rocket_rounds SET was_beautiful = true WHERE id = $1', [roundId]);
  }

  await query(
    `UPDATE rocket_rounds SET cashout_at = $1, profit = $2, crash_at = $3 WHERE id = $4`,
    [currentMult, grossWin - bet, finalCrash, roundId]
  );

  // `was_beautiful` в ответ не кладём: это внутренняя метка (см. комментарий
  // в `maybeBeautifulFlight`), она не нужна ни для выплаты, ни для анимации —
  // клиент и так получает настоящий `crash_at` и рисует полёт призрака по нему.
  // Утечка флага через API/сокеты подсказывала бы игроку устройство раунда.
  return {
    result: 'win' as const,
    cashout_at: Math.round(currentMult * 100) / 100,
    crash_at: Math.round(finalCrash * 100) / 100,
    profit: Math.round((grossWin - bet) * 100) / 100,
    gross_win: grossWin
  };
}

export async function processCrash(roundId: number) {
  await query(
    `UPDATE rocket_rounds SET profit = -bet WHERE id = $1 AND cashout_at IS NULL`,
    [roundId]
  );
}

/**
 * Раунд считается НЕзавершённым, пока не проставлен результат: у проигравшего
 * `profit = -bet` (< 0), у забравшего — `cashout_at` не null. Такой раунд
 * хранить в публичной истории нельзя: вместе со строкой уезжает и `crash_at`,
 * то есть точка взрыва текущего полёта.
 */
export const UNSETTLED_ROUND_SQL = `(cashout_at IS NULL AND COALESCE(profit, 0) = 0)`;

export async function getRocketHistory(limit = 50) {
  const res = await query(
    `SELECT r.*, u.username
     FROM rocket_rounds r
     JOIN users u ON u.id = r.user_id
     WHERE NOT ${UNSETTLED_ROUND_SQL}
     ORDER BY r.id DESC
     LIMIT $1`,
    [limit]
  );
  // `was_beautiful` остаётся в БД для внутренней аналитики, но в публичную
  // ленту раундов не попадает (см. `processCashoutImpl`).
  return res.rows.map(r => ({
    round_id: r.id,
    player: '@' + (r.username || 'user'),
    bet: parseFloat(r.bet),
    cashout_at: r.cashout_at ? parseFloat(r.cashout_at) : null,
    crash_at: parseFloat(r.crash_at),
    profit: parseFloat(r.profit),
    timestamp: r.started_at
  }));
}


/**
 * Атомарно занять раунд для серверных тиков.
 *
 * `UPDATE ... WHERE tick_started_at IS NULL ... RETURNING` гарантирует, что
 * тики запустит ровно один экземпляр backend (при двух — второй получит null),
 * и записывает серверный якорь времени, по которому cashout считается на любом
 * инстансе.
 */
export async function claimRocketTick(roundId: number, userId: number): Promise<{ crashAt: number; startedAt: number } | null> {
  const res = await query(
    `UPDATE rocket_rounds
        SET tick_started_at = NOW()
      WHERE id = $1 AND user_id = $2 AND tick_started_at IS NULL AND cashout_at IS NULL
        AND COALESCE(profit, 0) = 0
      RETURNING crash_at, tick_started_at`,
    [roundId, userId]
  );
  if (!res.rows.length) return null;
  return { crashAt: parseFloat(res.rows[0].crash_at), startedAt: new Date(res.rows[0].tick_started_at).getTime() };
}

/**
 * Дорасчёт раундов, зависших без результата.
 *
 * Если backend перезапустили в середине полёта, интервал тиков исчезает вместе
 * с процессом: раунд остаётся незавершённым навсегда, ставка не списана, а
 * `crash_at` продолжает лежать в БД (и утекать в историю/реплей, если их не
 * фильтровать). Cron закрывает такие раунды как проигрыш — ровно тем же
 * `processCrash`, которым это сделал бы тик.
 *
 * Порог: время, за которое раунд гарантированно достиг бы CRASH_HARD_CAP.
 */
export const STALE_ROUND_GRACE_SEC = Math.ceil(Math.log(CRASH_HARD_CAP) / FLIGHT_CURVE) + 30;

export async function settleStaleRounds(): Promise<number> {
  // Порог считаем на стороне JS и сравниваем метки: арифметика интервалов
  // timestamptz в разных движках ведёт себя по-разному (в pg-mem, на котором
  // живут смоук-тесты, её просто нет).
  const cutoff = new Date(Date.now() - STALE_ROUND_GRACE_SEC * 1000);
  const res = await query(
    `UPDATE rocket_rounds
        SET profit = -bet
      WHERE ${UNSETTLED_ROUND_SQL}
        AND tick_started_at IS NOT NULL
        AND tick_started_at < $1
      RETURNING id`,
    [cutoff]
  );
  return res.rowCount || 0;
}

// Составные денежные операции целиком выполняются в одной SQL-транзакции.
export const placeBet: typeof placeBetImpl = (...args: Parameters<typeof placeBetImpl>) => withTransaction(() => placeBetImpl(...args));
export const processCashout: typeof processCashoutImpl = (...args: Parameters<typeof processCashoutImpl>) => withTransaction(() => processCashoutImpl(...args));
