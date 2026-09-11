import { query } from '../db/pool';
import { getUser, modifyBalance, getAvailableBalance } from './balance';
import { logPlatformRevenue, getSetting } from './revenue';
import { payReferral } from './referral';

export async function createDuel(userId: number, amount: number) {
  const user = await getUser(userId);
  if (!user) throw new Error('Пользователь не найден');

  const minBet = parseFloat(await getSetting('min_bet') || '1');
  if (amount < minBet) throw new Error(`Мин. ставка $${minBet}`);
  const available = await getAvailableBalance(userId);
  if (amount > available) throw new Error('Недостаточно средств');

  // Проверить кол-во активных вызовов
  const activeCount = await query(
    `SELECT COUNT(*) FROM duels WHERE creator_id = $1 AND status = 'waiting'`,
    [userId]
  );
  if (parseInt(activeCount.rows[0].count) >= 3) {
    throw new Error('Максимум 3 открытых вызова');
  }

  // Заморозить средства
  await query('UPDATE users SET frozen_balance = frozen_balance + $1 WHERE id = $2', [amount, userId]);
  await modifyBalance(userId, -amount, 'bet', { gameType: 'duel' });

  const res = await query(
    `INSERT INTO duels (creator_id, amount, status)
     VALUES ($1, $2, 'waiting') RETURNING id`,
    [userId, amount]
  );

  return { duel_id: res.rows[0].id };
}

export async function getLobby() {
  const res = await query(
    `SELECT d.*, u.username as creator_name
     FROM duels d
     JOIN users u ON u.id = d.creator_id
     WHERE d.status = 'waiting'
     ORDER BY d.created_at DESC`,
    []
  );
  return res.rows.map(r => ({
    id: r.id,
    creator_id: r.creator_id,
    creator_name: '@' + (r.creator_name || 'user'),
    amount: parseFloat(r.amount),
    created_at: r.created_at
  }));
}

export async function cancelDuel(duelId: number, userId: number) {
  const res = await query('SELECT * FROM duels WHERE id = $1', [duelId]);
  if (res.rows.length === 0) throw new Error('Дуэль не найдена');
  const duel = res.rows[0];
  if (duel.creator_id !== userId) throw new Error('Не ваш вызов');
  if (duel.status !== 'waiting') throw new Error('Нельзя отменить');

  const amount = parseFloat(duel.amount);
  await query('UPDATE users SET frozen_balance = frozen_balance - $1 WHERE id = $2', [amount, userId]);
  await modifyBalance(userId, amount, 'duel_cancel', { gameType: 'duel' });
  await query("UPDATE duels SET status = 'cancelled' WHERE id = $1", [duelId]);
  return { success: true };
}

export async function acceptDuel(duelId: number, opponentId: number) {
  const duelRes = await query('SELECT * FROM duels WHERE id = $1', [duelId]);
  if (duelRes.rows.length === 0) throw new Error('Дуэль не найдена');
  const duel = duelRes.rows[0];
  if (duel.status !== 'waiting') throw new Error('Вызов уже принят или отменён');
  if (duel.creator_id === opponentId) throw new Error('Нельзя играть с самим собой');

  const amount = parseFloat(duel.amount);
  const available = await getAvailableBalance(opponentId);
  if (amount > available) throw new Error('Недостаточно средств');

  // Списать у оппонента
  await modifyBalance(opponentId, -amount, 'bet', { gameType: 'duel' });
  // Разморозить у создателя
  await query('UPDATE users SET frozen_balance = frozen_balance - $1 WHERE id = $2', [amount, duel.creator_id]);

  // Орёл или решка
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const winnerId = result === 'heads' ? duel.creator_id : opponentId;

  // Комиссия 10% от общего банка
  const total = amount * 2;
  const commission = Math.round(total * 0.10 * 100) / 100;
  const prize = Math.round((total - commission) * 100) / 100;

  // Распределение комиссии для обоих игроков
  for (const pid of [duel.creator_id, opponentId]) {
    const refCut = await payReferral(pid, amount, 'duel');
    const platformCut = Math.round((amount * 0.10 - refCut) * 100) / 100;
    if (platformCut > 0) {
      await logPlatformRevenue(platformCut, 'duel');
    }
  }

  // Выплата победителю
  await modifyBalance(winnerId, prize, 'win', {
    gameType: 'duel', gameId: duelId,
    description: `Победа в дуэли`
  });

  // Траектория монеты
  const coinTrajectory = {
    rotation_speed: +(3 + Math.random() * 3).toFixed(1),
    height: +(2.5 + Math.random() * 2.5).toFixed(1),
    bounces: Math.floor(1 + Math.random() * 3),
    final_angle: +(Math.random() * 360).toFixed(1)
  };

  await query(
    `UPDATE duels SET status = 'finished', result = $1, winner_id = $2,
     opponent_id = $3, coin_trajectory = $4, finished_at = NOW()
     WHERE id = $5`,
    [result, winnerId, opponentId, JSON.stringify(coinTrajectory), duelId]
  );

  return {
    result,
    winner: winnerId,
    prize,
    coin_trajectory: coinTrajectory,
    creator_id: duel.creator_id,
    opponent_id: opponentId
  };
}

export async function getDuelHistory(limit = 50) {
  const res = await query(
    `SELECT d.*, u1.username as creator_name, u2.username as opponent_name, u3.username as winner_name
     FROM duels d
     JOIN users u1 ON u1.id = d.creator_id
     LEFT JOIN users u2 ON u2.id = d.opponent_id
     LEFT JOIN users u3 ON u3.id = d.winner_id
     WHERE d.status = 'finished'
     ORDER BY d.finished_at DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows.map(r => ({
    id: r.id,
    creator: '@' + (r.creator_name || 'user'),
    opponent: r.opponent_name ? '@' + r.opponent_name : null,
    winner: r.winner_name ? '@' + r.winner_name : null,
    amount: parseFloat(r.amount),
    result: r.result,
    finished_at: r.finished_at,
    coin_trajectory: r.coin_trajectory
  }));
}

export async function getDuel(id: number) {
  const res = await query('SELECT * FROM duels WHERE id = $1', [id]);
  return res.rows[0] || null;
}
