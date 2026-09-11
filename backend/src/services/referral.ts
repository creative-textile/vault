import { query } from '../db/pool';
import { getUser } from './balance';
import { logPlatformRevenue } from './revenue';

/**
 * Начисляет 3% рефоводу от ставки. Если нет рефовода — эти 3% идут админу.
 * Возвращает сколько пошло рефоводу.
 */
export async function payReferral(userId: number, betAmount: number, gameType: string): Promise<number> {
  const user = await getUser(userId);
  if (!user || !user.referred_by) return 0;

  const refPercent = parseInt((await (await import('./revenue')).getSetting('referral_percent')) || '3');
  const reward = Math.round(betAmount * (refPercent / 100) * 100) / 100;

  const referrer = await getUser(user.referred_by);
  if (!referrer) return 0;

  await (await import('./balance')).modifyBalance(
    user.referred_by,
    reward,
    'referral',
    {
      gameType,
      description: `3% от ставки $${betAmount}`
    }
  );

  return reward;
}

/**
 * Создаёт уникальный реф-код
 */
export function generateRefCode(): string {
  return Math.random().toString(36).substring(2, 8);
}

export async function getReferralStats(userId: number) {
  const res = await query(
    `SELECT u.id, u.username,
            COALESCE((SELECT SUM(ABS(amount)) FROM transactions t
                        WHERE t.user_id = u.id AND t.type = 'bet'), 0) AS total_bets
       FROM users u
      WHERE u.referred_by = $1
      ORDER BY u.id DESC`,
    [userId]
  );

  // Сколько заработал рефовод с каждого реферала отдельно
  const rows = [];
  let totalEarned = 0;
  for (const r of res.rows) {
    const earnedRes = await query(
      `SELECT COALESCE(SUM(amount),0) AS earned FROM transactions
        WHERE user_id = $1 AND type = 'referral'
          AND description LIKE '%' || (SELECT username FROM users WHERE id = $2) || '%'
          OR (user_id = $1 AND type = 'referral'
              AND created_at >= (SELECT created_at FROM users WHERE id = $2))`,
      [userId, r.id]
    );
    // Упрощённый подсчёт: сумма всех referral с момента регистрации реферала (на человека не распадается идеально)
    const bets = parseFloat(r.total_bets) || 0;
    const refPct = parseInt((await getSettingLocal('referral_percent')) || '3');
    const earned = Math.round(bets * (refPct/100) * 100)/100;
    totalEarned += earned;
    rows.push({
      username: r.username,
      total_bets: bets,
      earned_from: earned
    });
  }

  // Итоговый заработок из таблицы транзакций (точное число)
  const totalRes = await query(
    `SELECT COALESCE(SUM(amount),0) AS earned, COUNT(*) AS cnt
       FROM transactions WHERE user_id = $1 AND type = 'referral'`,
    [userId]
  );

  return {
    referrals: rows,
    total_referrals: rows.length,
    total_earned: parseFloat(totalRes.rows[0].earned) || totalEarned
  };
}

async function getSettingLocal(key: string): Promise<string> {
  const { getSetting } = await import('./revenue');
  return (await getSetting(key)) || '';
}
