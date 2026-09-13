import { query } from '../db/pool';
import { getUser, modifyBalance, getAvailableBalance } from './balance';
import { logPlatformRevenue, getSetting } from './revenue';
import { payReferral } from './referral';
import { roundDownClean } from '../config';

const FLIGHT_CURVE = 0.075;

export function getMultiplierAt(elapsedSec: number): number {
  return Math.exp(FLIGHT_CURVE * elapsedSec);
}

export function calculateCrashPoint(bet: number, bankroll: number): number {
  // 1. Макс. по кассе
  const maxByBankroll = bankroll / bet;
  // 2. Случайная точка (10% house edge)
  const r = Math.random();
  const randomCrash = 0.90 / (1 - r);
  // 3. Защита кассы
  let crash = Math.min(randomCrash, maxByBankroll);
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

export async function updateRocketBankroll(delta: number) {
  await query('UPDATE rocket_bankroll SET amount = amount + $1, updated_at = NOW() WHERE id = 1', [delta]);
}

export async function placeBet(userId: number, betAmount: number) {
  const user = await getUser(userId);
  if (!user) throw new Error('Пользователь не найден');

  const bankroll = await getRocketBankroll();
  const maxBetPercent = parseInt(await getSetting('rocket_max_bet_percent') || '50');
  const rawMax = bankroll * (maxBetPercent / 100);
  const maxBet = roundDownClean(rawMax);
  const available = await getAvailableBalance(userId);

  const minBet = parseFloat(await getSetting('min_bet') || '1');
  if (betAmount < minBet) throw new Error(`Минимальная ставка: $${minBet}`);
  if (Math.round(betAmount * 100) > Math.round(available * 100)) throw new Error('Недостаточно средств');
  if (betAmount > maxBet) throw new Error(`Максимальная ставка: $${maxBet}`);

  // Списать ставку
  await modifyBalance(userId, -betAmount, 'bet', { gameType: 'rocket' });

  // Комиссия 10%
  const commission = Math.round(betAmount * 0.10 * 100) / 100;
  const toBankroll = betAmount - commission; // 90%
  const toReferrer = await payReferral(userId, betAmount, 'rocket'); // 3%
  const toPlatform = commission - toReferrer; // 7%

  await updateRocketBankroll(toBankroll);
  if (toPlatform > 0) {
    await logPlatformRevenue(toPlatform, 'rocket');
  }

  // Точка взрыва
  const crashAt = calculateCrashPoint(betAmount, bankroll + toBankroll);

  const res = await query(
    `INSERT INTO rocket_rounds (user_id, bet, crash_at, flight_curve)
     VALUES ($1, $2, $3, $4) RETURNING id, crash_at`,
    [userId, betAmount, crashAt, FLIGHT_CURVE]
  );

  return {
    round_id: res.rows[0].id,
    crash_at: crashAt,
    max_bet: maxBet
  };
}

export async function processCashout(roundId: number, userId: number, elapsedSec: number) {
  const res = await query('SELECT * FROM rocket_rounds WHERE id = $1', [roundId]);
  if (res.rows.length === 0) throw new Error('Раунд не найден');
  const round = res.rows[0];
  if (round.user_id !== userId) throw new Error('Не ваш раунд');
  if (round.cashout_at) throw new Error('Уже забрали');

  const currentMult = getMultiplierAt(elapsedSec);
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

export async function getRocketHistory(limit = 50) {
  const res = await query(
    `SELECT r.*, u.username
     FROM rocket_rounds r
     JOIN users u ON u.id = r.user_id
     ORDER BY r.id DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows.map(r => ({
    round_id: r.id,
    player: '@' + (r.username || 'user'),
    bet: parseFloat(r.bet),
    cashout_at: r.cashout_at ? parseFloat(r.cashout_at) : null,
    crash_at: parseFloat(r.crash_at),
    profit: parseFloat(r.profit),
    was_beautiful: r.was_beautiful,
    timestamp: r.started_at
  }));
}
