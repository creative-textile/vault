import { query, getClient } from '../db/pool';
import { getUser, modifyBalance, getAvailableBalance } from './balance';
import { logPlatformRevenue, getSetting } from './revenue';
import { payReferral } from './referral';
import { notifyDuelResult } from './notifications';

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

  // Ставка открытого вызова ЗАМАРАЖИВАЕТСЯ, но не списывается: списание и
  // заморозка вместе означали, что available = balance − frozen уменьшается
  // вдвое, и пока вызов висит в лобби, игрок не мог распоряжаться своими же
  // деньгами (при трёх вызовах available вообще уходил в минус). Деньги
  // спишутся в acceptDuel — когда дуэль действительно сыграна.
  await query('UPDATE users SET frozen_balance = frozen_balance + $1 WHERE id = $2', [amount, userId]);

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
  // Ставка не списывалась — значит и возвращать нечего, только разморозить
  await query('UPDATE users SET frozen_balance = frozen_balance - $1 WHERE id = $2', [amount, userId]);
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

  // Атомарно занимаем вызов ДО любых операций с деньгами. Проверка статуса
  // через SELECT оставляла гонку: два одновременных «Принять» (двойной клик,
  // два устройства, два игрока на одну строку лобби) проходили её оба —
  // ставки списывались у обоих, приз выплачивался дважды, а второй игрок
  // терял деньги за дуэль, которой не было. Статус `playing` сразу убирает
  // вызов из лобби, а второй претендент получает «Вызов уже принят».
  const claim = await query(
    `UPDATE duels SET status = 'playing', opponent_id = $1
      WHERE id = $2 AND status = 'waiting'
      RETURNING id`,
    [opponentId, duelId]
  );
  if (claim.rows.length === 0) throw new Error('Вызов уже принят или отменён');

  // Списать у оппонента
  await modifyBalance(opponentId, -amount, 'bet', { gameType: 'duel', gameId: duelId });
  // У создателя ставка до сих пор была заморожена, а не списана: размораживаем
  // и списываем теперь, когда дуэль действительно сыграна
  await query('UPDATE users SET frozen_balance = frozen_balance - $1 WHERE id = $2', [amount, duel.creator_id]);
  await modifyBalance(duel.creator_id, -amount, 'bet', { gameType: 'duel', gameId: duelId });

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

// ════════════════════════════════════════════════════════════════════════
// Уведомления о результате дуэли.
//
// Дуэль решается на сервере в момент принятия вызова (acceptDuel), поэтому
// создатель комнаты может быть где угодно: на другой вкладке, в другом экране
// или вообще закрыть приложение на несколько дней. Уведомление ОБЯЗАНО до него
// дойти, и доходит двумя путями:
//   1. socket `notification` + запись в user_notifications сразу в accept;
//   2. досоздание (ensureDuelResultNotifications) при каждом запросе списка —
//      страховка на случай, если запись не создалась или игрок зашёл позже.
// Клиент показывает их модальным окном с очередью: несколько дуэлей подряд —
// несколько окон по очереди, каждое с кнопками «смотреть реплей» / «закрыть».
// ════════════════════════════════════════════════════════════════════════

/** Приз победителю: банк 2×ставка минус 10% комиссии. */
function duelPrize(amount: number): number {
  return Math.round(amount * 2 * 0.9 * 100) / 100;
}

async function getDuelWithNames(duelId: number) {
  const res = await query(
    `SELECT d.*, uc.username AS creator_name, uo.username AS opponent_name
     FROM duels d
     JOIN users uc ON uc.id = d.creator_id
     LEFT JOIN users uo ON uo.id = d.opponent_id
     WHERE d.id = $1`,
    [duelId]
  );
  return res.rows[0] || null;
}

/** Есть ли уже уведомление о этой дуэли для этого игрока (прочитанное тоже считается). */
async function hasDuelNotification(duelId: number, userId: number): Promise<boolean> {
  const res = await query(
    `SELECT id FROM user_notifications
      WHERE user_id = $1 AND type = 'duel_result' AND (data->>'duel_id') = $2::text
      LIMIT 1`,
    [userId, String(duelId)]
  );
  return res.rows.length > 0;
}

/**
 * Уведомление одному участнику дуэли. Идемпотентно: повторный вызов не создаёт
 * вторую запись, поэтому досоздание из списка уведомлений безопасно.
 */
export async function notifyDuelParticipant(duelId: number, userId: number): Promise<boolean> {
  if (!userId) return false;
  const d = await getDuelWithNames(duelId);
  if (!d || d.status !== 'finished') return false;
  if (await hasDuelNotification(duelId, userId)) return false;

  const isCreator = d.creator_id === userId;
  const amount = parseFloat(d.amount);
  const otherName = isCreator ? d.opponent_name : d.creator_name;
  const nickname = otherName ? `@${otherName}` : 'соперник';

  const message = isCreator
    ? `⚔️ Ваш вызов на $${amount.toFixed(2)} принял ${nickname} — дуэль состоялась`
    : `⚔️ Вы приняли вызов ${nickname} на $${amount.toFixed(2)} — дуэль состоялась`;

  await notifyDuelResult(userId, duelId, message, {
    duel_id: duelId,
    amount,
    prize: duelPrize(amount),
    result: d.result,
    winner_id: d.winner_id,
    i_won: d.winner_id === userId,
    opponent_id: isCreator ? d.opponent_id : d.creator_id,
    opponent_name: otherName ? `@${otherName}` : null,
    coin_trajectory: d.coin_trajectory,
    finished_at: d.finished_at
  });
  return true;
}

/** Уведомить обоих участников (вызывается сразу после завершения дуэли). */
export async function notifyDuelFinished(duelId: number) {
  const d = await getDuelWithNames(duelId);
  if (!d || d.status !== 'finished') return;
  await notifyDuelParticipant(duelId, d.creator_id);
  await notifyDuelParticipant(duelId, d.opponent_id);
}

/**
 * Досоздать уведомления о завершённых дуэлях игрока, если их нет в базе.
 *
 * Это и есть гарантия «вышел из приложения на несколько дней, зашёл снова —
 * модальное окно появилось»: список непрочитанных читается из БД, а не из
 * localStorage вкладки. Заодно закрывает случай, когда уведомление не
 * записалось в момент accept (сбой, рестарт процесса).
 *
 * Возвращает число досозданных уведомлений.
 */
export async function ensureDuelResultNotifications(userId: number): Promise<number> {
  const finished = await query(
    `SELECT id FROM duels
      WHERE status = 'finished' AND (creator_id = $1 OR opponent_id = $1)
      ORDER BY finished_at DESC
      LIMIT 50`,
    [userId]
  );
  if (!finished.rows.length) return 0;

  const known = await query(
    `SELECT (data->>'duel_id') AS duel_id FROM user_notifications
      WHERE user_id = $1 AND type = 'duel_result'`,
    [userId]
  );
  const have = new Set(known.rows.map(r => String(r.duel_id)));

  let created = 0;
  for (const row of finished.rows) {
    if (have.has(String(row.id))) continue;
    try {
      if (await notifyDuelParticipant(row.id, userId)) created++;
    } catch (e: any) {
      console.error(`[DUEL] не удалось досоздать уведомление о дуэли #${row.id}:`, e.message);
    }
  }
  if (created) console.log(`[DUEL] Досоздано уведомлений о результатах дуэлей для user ${userId}: ${created}`);
  return created;
}

/**
 * Разовая починка вызовов, созданных ДО исправления двойной блокировки ставки.
 *
 * Раньше createDuel и замораживал ставку, и списывал её с баланса. Теперь
 * вызов только замораживает, а списывает acceptDuel. Вызовы, которые до сих
 * пор висят в лобби, надо вернуть на баланс: иначе при принятии такого вызова
 * ставка списалась бы у создателя второй раз, а при отмене — осталась бы
 * списанной навсегда (разморозка уже не возвращает деньги).
 *
 * Вызывается ОДИН раз — за флагом `duel_double_lock_fixed` в settings (см.
 * src/index.ts): вызовы, созданные уже по новой схеме, не списаны, и повторный
 * прогон начислил бы игроку деньги из воздуха. Внутри идемпотентна: каждый
 * возврат отмечается транзакцией `duel_unlock` с game_id, поэтому падение
 * процесса посреди починки не возвращает деньги дважды. Баланс и транзакция
 * меняются в одной DB-транзакции — половинчатого состояния не возникает.
 */
export async function repairDoubleLockedOpenDuels(): Promise<number> {
  const open = await query(`SELECT id, creator_id, amount FROM duels WHERE status = 'waiting'`);
  let fixed = 0;
  for (const d of open.rows) {
    const amount = parseFloat(d.amount);
    if (!(amount > 0)) continue;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const already = await client.query(
        `SELECT 1 FROM transactions
          WHERE user_id = $1 AND type = 'duel_unlock' AND game_id = $2 LIMIT 1`,
        [d.creator_id, d.id]
      );
      if (already.rows.length) {
        await client.query('ROLLBACK');
        continue;
      }
      const upd = await client.query(
        `UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
        [amount, d.creator_id]
      );
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_after, game_type, game_id, description)
         VALUES ($1, 'duel_unlock', $2, $3, 'duel', $4, 'Возврат ставки вызова на баланс')`,
        [d.creator_id, amount, parseFloat(upd.rows[0]?.balance || '0'), d.id]
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
