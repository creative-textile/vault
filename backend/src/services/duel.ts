import { query, getClient } from '../db/pool';
import { withTransaction } from '../db/pool';
import { getUser, modifyBalance, getAvailableBalance } from './balance';
import { logPlatformRevenue, getSetting } from './revenue';
import { payReferral } from './referral';
import { notifyDuelResult, notifyPreferred } from './notifications';

async function createDuelImpl(userId: number, amount: number, opts: { targetUserId?: number | null; parentDuelId?: number | null } = {}) {
  const user = await getUser(userId);
  if (!user) throw new Error('Пользователь не найден');

  const minBet = parseFloat(await getSetting('min_bet') || '1');
  if (amount < minBet) throw new Error(`Мин. ставка $${minBet}`);
  const available = await getAvailableBalance(userId);
  if (Math.round(amount * 100) > Math.round(available * 100)) throw new Error('Недостаточно средств');

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
  const frozen = await query(`UPDATE users SET frozen_balance=frozen_balance+$1 WHERE id=$2 AND balance-frozen_balance >= $1 RETURNING id`,[amount,userId]);
  if (!frozen.rows.length) throw new Error('Недостаточно средств');

  // target_user_id / parent_duel_id пишутся СРАЗУ: раньше реванш создавался
  // обычным вызовом, а адресат проставлялся отдельным UPDATE — в этом окне
  // адресный реванш был виден всему лобби и его мог принять любой игрок.
  const res = await query(
    `INSERT INTO duels (creator_id, amount, status, target_user_id, parent_duel_id)
     VALUES ($1, $2, 'waiting', $3, $4) RETURNING id`,
    [userId, amount, opts.targetUserId ?? null, opts.parentDuelId ?? null]
  );

  return { duel_id: res.rows[0].id };
}

export async function createRematch(userId:number,sourceId:number,multiplier=1) {
  const source=await getDuel(sourceId);
  if(!source || source.status!=='finished' || ![Number(source.creator_id),Number(source.opponent_id)].includes(Number(userId))) throw new Error('Исходная дуэль недоступна');
  const target=Number(source.creator_id)===Number(userId) ? Number(source.opponent_id) : Number(source.creator_id);
  const amount=Math.round(Number(source.amount)*Math.min(2,Math.max(1,multiplier))*100)/100;
  // Одна операция: вызов создаётся уже адресным (см. createDuelImpl)
  const made=await createDuel(userId,amount,{targetUserId:target,parentDuelId:sourceId});
  await notifyPreferred(target,'notif_duel',`Вам предложен реванш на $${amount.toFixed(2)}`,'duel_rematch','Реванш',{duel_id:made.duel_id,parent_duel_id:sourceId},'duel_rematch',made.duel_id);
  return {...made,target_user_id:target,amount};
}

async function declineRematchImpl(duelId:number,userId:number) {
  const d=(await query(`SELECT * FROM duels WHERE id=$1`,[duelId])).rows[0];
  if(!d || d.status!=='waiting' || Number(d.target_user_id)!==Number(userId)) throw new Error('Реванш недоступен');
  const amount=Number(d.amount);
  // Атомарный захват: статус, адресат и сумма возвращаются одним UPDATE,
  // поэтому второй «отклонить» не пройдёт и не разморозит ставку повторно.
  const claim=await query(`UPDATE duels SET status='declined'
                            WHERE id=$1 AND status='waiting' AND target_user_id=$2
                            RETURNING id, amount, creator_id`,[duelId,userId]);
  if(!claim.rows.length) throw new Error('Реванш уже обработан');
  const unfrozen=await query(`UPDATE users SET frozen_balance=frozen_balance-$1 WHERE id=$2 AND frozen_balance >= $1 RETURNING id`,[Number(claim.rows[0].amount),Number(claim.rows[0].creator_id)]);
  if(!unfrozen.rows.length) throw new Error('Ставка вызова уже разморожена');
  await notifyPreferred(d.creator_id,'notif_duel','Соперник отклонил реванш','duel_rematch_declined','Реванш отклонён',{duel_id:duelId},'duel_rematch_declined',duelId);
  return {success:true};
}

/**
 * Лобби вызовов.
 *
 * Адресный реванш (`target_user_id`) виден только адресату и создателю
 * (создателю — чтобы отменить свой вызов). Раньше этот фильтр жил исключительно
 * в клиенте (Duel.tsx), поэтому запрос к API напрямую показывал чужие приватные
 * реванши; acceptDuel не давал их принять, но сам факт утечки лишним не был.
 * Анонимный запрос (без токена) получает только открытые вызовы.
 */
export async function getLobby(viewerId?: number | null) {
  const res = await query(
    `SELECT d.*, u.username as creator_name
     FROM duels d
     JOIN users u ON u.id = d.creator_id
     WHERE d.status = 'waiting'
       AND (d.target_user_id IS NULL OR d.target_user_id = $1 OR d.creator_id = $1)
     ORDER BY d.created_at DESC`,
    [Number.isFinite(Number(viewerId)) && Number(viewerId) > 0 ? Number(viewerId) : -1]
  );
  return res.rows.map(r => ({
    id: r.id,
    creator_id: r.creator_id,
    creator_name: '@' + (r.creator_name || 'user'),
    amount: parseFloat(r.amount),
    created_at: r.created_at,
    target_user_id: r.target_user_id,
    parent_duel_id: r.parent_duel_id
  }));
}

async function cancelDuelImpl(duelId: number, userId: number) {
  const res = await query('SELECT * FROM duels WHERE id = $1', [duelId]);
  if (res.rows.length === 0) throw new Error('Дуэль не найдена');
  const duel = res.rows[0];
  if (Number(duel.creator_id) !== Number(userId)) throw new Error('Не ваш вызов');
  if (duel.status !== 'waiting') throw new Error('Нельзя отменить');

  // СНАЧАЛА атомарный захват строки, ПОТОМ разморозка. Прежний порядок
  // (проверка статуса отдельным SELECT → разморозка → UPDATE статуса) давал
  // воспроизводимую на реальном PostgreSQL гонку: два одновременных «Отменить»
  // (двойной клик / два устройства) оба проходили проверку и размораживали
  // ставку дважды, завышая доступный баланс. `WHERE status='waiting'` во втором
  // запросе не пройдёт — одна из двух транзакций получит 0 строк.
  const claim = await query(
    `UPDATE duels SET status = 'cancelled'
      WHERE id = $1 AND creator_id = $2 AND status = 'waiting'
      RETURNING amount`,
    [duelId, userId]
  );
  if (claim.rows.length === 0) throw new Error('Нельзя отменить');
  const amount = parseFloat(claim.rows[0].amount);
  // Ставка не списывалась — значит и возвращать нечего, только разморозить
  const unfrozen=await query(`UPDATE users SET frozen_balance=frozen_balance-$1 WHERE id=$2 AND frozen_balance >= $1 RETURNING id`,[amount,userId]);
  if (!unfrozen.rows.length) throw new Error('Средства вызова уже разморожены');
  return { success: true };
}

async function acceptDuelImpl(duelId: number, opponentId: number) {
  const duelRes = await query('SELECT * FROM duels WHERE id = $1', [duelId]);
  if (duelRes.rows.length === 0) throw new Error('Дуэль не найдена');
  const duel = duelRes.rows[0];
  if (duel.status !== 'waiting') throw new Error('Вызов уже принят или отменён');
  if (duel.creator_id === opponentId) throw new Error('Нельзя играть с самим собой');
  if (duel.target_user_id && duel.target_user_id !== opponentId) throw new Error('Этот реванш адресован другому игроку');

  const amount = parseFloat(duel.amount);
  const available = await getAvailableBalance(opponentId);
  if (Math.round(amount * 100) > Math.round(available * 100)) throw new Error('Недостаточно средств');

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
  const creatorUnfreeze=await query(`UPDATE users SET frozen_balance=frozen_balance-$1 WHERE id=$2 AND frozen_balance >= $1 RETURNING id`,[amount,duel.creator_id]);
  if (!creatorUnfreeze.rows.length) throw new Error('Ставка создателя не зарезервирована');
  await modifyBalance(duel.creator_id, -amount, 'bet', { gameType: 'duel', gameId: duelId });

  // Орёл или решка
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const winnerId = result === 'heads' ? duel.creator_id : opponentId;

  const total = amount * 2;
  const commissionPercent = parseFloat(await getSetting('commission_percent') || '10');
  const commission = Math.round(total * (commissionPercent / 100) * 100) / 100;
  const prize = Math.round((total - commission) * 100) / 100;

  // Распределение комиссии для обоих игроков
  for (const pid of [duel.creator_id, opponentId]) {
    const refCut = await payReferral(pid, amount, 'duel');
    const platformCut = Math.round((amount * (commissionPercent / 100) - refCut) * 100) / 100;
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
    id: duelId,
    status: 'finished',
    result,
    winner: winnerId,
    winner_id: winnerId,
    prize,
    amount,
    i_won: winnerId === opponentId,
    coin_trajectory: coinTrajectory,
    creator_id: duel.creator_id,
    opponent_id: opponentId,
    finished_at: new Date().toISOString()
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

/**
 * Приз победителю: банк 2×ставка минус комиссия платформы.
 *
 * Процент читается из `commission_percent`, а не захардкожен: при изменении
 * комиссии в админке уведомления показывали бы приз, рассчитанный по прежним
 * 10%, тогда как acceptDuel платил по новым.
 */
export async function computeDuelPrize(amount: number): Promise<number> {
  const commissionPercent = parseFloat(await getSetting('commission_percent') || '10');
  return Math.round(amount * 2 * (1 - commissionPercent / 100) * 100) / 100;
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
    prize: await computeDuelPrize(amount),
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


// Составные денежные операции целиком выполняются в одной SQL-транзакции.
export const createDuel: typeof createDuelImpl = (...args: Parameters<typeof createDuelImpl>) => withTransaction(() => createDuelImpl(...args));
export const declineRematch: typeof declineRematchImpl = (...args: Parameters<typeof declineRematchImpl>) => withTransaction(() => declineRematchImpl(...args));
export const cancelDuel: typeof cancelDuelImpl = (...args: Parameters<typeof cancelDuelImpl>) => withTransaction(() => cancelDuelImpl(...args));
export const acceptDuel: typeof acceptDuelImpl = (...args: Parameters<typeof acceptDuelImpl>) => withTransaction(() => acceptDuelImpl(...args));
