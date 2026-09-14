import { Router } from 'express';
import { auth, adminOnly } from '../middleware/auth';
import { adminPassword, adminAudit, validId, validMoney } from '../middleware/security';
import { query, withTransaction } from '../../db/pool';
import { getSetting, setSetting } from '../../services/revenue';
import { getRocketBankroll, updateRocketBankroll } from '../../services/rocket';
import { addManualPool, getVaultPool } from '../../services/vault-deposit';
import { getBalanceSnapshot } from '../../services/balance';
import { getFinancialReconciliation } from '../../services/financial-audit';
import { listWithdrawals, payWithdrawal, rejectWithdrawal } from '../../services/ton';

const router = Router();

router.use(auth, adminOnly, adminAudit, adminPassword);

function rangeDates(from: string, to: string) {
  return { from: new Date(from + 'T00:00:00'), to: new Date(to + 'T23:59:59.999') };
}

const defaultRange = () => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from, to: new Date(to.getTime()) };
};

router.get('/reconciliation', async (_req,res) => {
  try { res.json(await getFinancialReconciliation()); } catch(e:any) { res.status(500).json({error:e.message}); }
});

// GET /api/admin/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/stats', async (req, res) => {
  try {
    let from: Date, to: Date;
    if (req.query.from && req.query.to) {
      ({ from, to } = rangeDates(String(req.query.from), String(req.query.to)));
    } else {
      ({ from, to } = defaultRange());
    }
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const usersCount = (await query('SELECT COUNT(*) FROM users')).rows[0].count;
    const newUsers = (await query(
      `SELECT COUNT(*) FROM users WHERE created_at BETWEEN $1 AND $2`,
      [from, to]
    )).rows[0].count;
    const activeRange = (await query(
      `SELECT COUNT(DISTINCT user_id) FROM transactions
       WHERE created_at BETWEEN $1 AND $2`,
      [from, to]
    )).rows[0].count;
    const totalTurnover = (await query(
      `SELECT COALESCE(SUM(ABS(amount)), 0) FROM transactions
       WHERE type = 'bet' AND created_at BETWEEN $1 AND $2`,
      [from, to]
    )).rows[0].coalesce;

    // Пополнения
    const depositsTotal = (await query(
      `SELECT COALESCE(SUM(amount), 0) FROM transactions
       WHERE type IN ('deposit', 'demo_deposit') AND created_at BETWEEN $1 AND $2`,
      [from, to]
    )).rows[0].coalesce;
    const depositsCount = (await query(
      `SELECT COUNT(*) FROM transactions
       WHERE type IN ('deposit', 'demo_deposit') AND created_at BETWEEN $1 AND $2`,
      [from, to]
    )).rows[0].count;

    // Выводы
    const withdrawsTotal = (await query(
      `SELECT COALESCE(SUM(ABS(amount)), 0) FROM transactions
       WHERE type = 'withdraw' AND created_at BETWEEN $1 AND $2`,
      [from, to]
    )).rows[0].coalesce;
    const withdrawsCount = (await query(
      `SELECT COUNT(*) FROM transactions
       WHERE type = 'withdraw' AND created_at BETWEEN $1 AND $2`,
      [from, to]
    )).rows[0].count;

    const bankroll = await getRocketBankroll();
    const platformCash = parseFloat(
      (await query('SELECT amount FROM platform_cashbox WHERE id = 1')).rows[0]?.amount || '0'
    );
    const vaultPool = await getVaultPool();

    // Доходы по источникам за период
    const revBySource: Record<string, number> = {};
    const revRows = await query(
      `SELECT source, COALESCE(SUM(amount),0) AS total FROM daily_revenue
       WHERE date BETWEEN $1 AND $2 GROUP BY source`,
      [fromStr, toStr]
    );
    for (const r of revRows.rows) revBySource[r.source] = parseFloat(r.total);

    const vaultLockedRes = await query(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM vault_deposits WHERE status = 'active'`
    );
    const vaultPoolLatest = (await query(
      `SELECT * FROM vault_pool_daily ORDER BY date DESC LIMIT 1`
    )).rows[0];

    // Последние 10 транзакций
    const recentTx = await query(
      `SELECT t.*, u.username FROM transactions t JOIN users u ON u.id = t.user_id
       ORDER BY t.id DESC LIMIT 15`
    );

    const poolHistory = await query(
      `SELECT * FROM vault_pool_daily ORDER BY date DESC LIMIT 14`
    );

    // Последние переводы между кассами
    const transferHistory = await query(
      `SELECT * FROM cashbox_transfers ORDER BY id DESC LIMIT 20`
    );

    res.json({
      range: { from: fromStr, to: toStr },
      users_count: parseInt(usersCount),
      new_users_range: parseInt(newUsers),
      active_range: parseInt(activeRange),
      total_turnover: parseFloat(totalTurnover),
      deposits_total: parseFloat(depositsTotal),
      deposits_count: parseInt(depositsCount),
      withdraws_total: parseFloat(withdrawsTotal),
      withdraws_count: parseInt(withdrawsCount),
      rocket_bankroll: bankroll,
      platform_cashbox: platformCash,
      vault_pool_total: vaultPool,
      revenue_by_source: revBySource,
      total_revenue: Object.values(revBySource).reduce((a, b) => a + b, 0),
      vault: {
        total_locked: parseFloat(vaultLockedRes.rows[0].total),
        depositors: parseInt(vaultLockedRes.rows[0].cnt),
        today: vaultPoolLatest ? {
          date: vaultPoolLatest.date,
          total_pool: parseFloat(vaultPoolLatest.total_pool),
          auto_pool: parseFloat(vaultPoolLatest.auto_pool),
          manual_pool: parseFloat(vaultPoolLatest.manual_pool),
          base_rate: parseFloat(vaultPoolLatest.base_rate)
        } : null,
        max_deposit: await getSetting('vault_max_floor')
      },
      recent_transactions: recentTx.rows.map(r => ({
        id: r.id,
        username: r.username,
        type: r.type,
        amount: parseFloat(r.amount),
        description: r.description,
        game_type: r.game_type,
        created_at: r.created_at
      })),
      pool_history: poolHistory.rows.map(r => ({
        date: r.date,
        total_pool: parseFloat(r.total_pool),
        manual_pool: parseFloat(r.manual_pool),
        base_rate: parseFloat(r.base_rate)
      })),
      transfers: transferHistory.rows.map(r => ({
        id: r.id,
        from: r.from_source,
        to: r.to_source,
        amount: parseFloat(r.amount),
        note: r.note,
        created_at: r.created_at
      }))
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/rocket-bankroll (пополнить/снять из ГЛАВНОЙ кассы)
router.post('/rocket-bankroll', async (req, res) => {
  try {
    const { add, withdraw } = req.body;
    // Переводы между кассами — одна транзакция на операцию. Раньше каждый
    // `SELECT ... FOR UPDATE` выполнялся в autocommit: блокировка снималась
    // сразу после SELECT, поэтому два параллельных перевода читали одну и ту же
    // сумму и касса уходила в минус (CHECK-ограничение роняло второй UPDATE,
    // оставляя половину перевода выполненной).
    if (add) {
      const amt = parseFloat(add);
      if (!validMoney(amt,0.01)) throw new Error('Некорректная сумма');
      await withTransaction(async (client) => {
        const plat = await client.query('SELECT amount FROM platform_cashbox WHERE id = 1 FOR UPDATE');
        if (parseFloat(plat.rows[0].amount) < amt) throw new Error('В главной кассе недостаточно');
        await client.query('UPDATE platform_cashbox SET amount = amount - $1, updated_at = NOW() WHERE id = 1', [amt]);
        await updateRocketBankroll(amt);
        await client.query(
          `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
           VALUES ('platform', 'rocket', $1, 'Ручное пополнение кассы Ракеты')`,
          [amt]
        );
      });
    }
    if (withdraw) {
      const amt = parseFloat(withdraw);
      if (!validMoney(amt,0.01)) throw new Error('Некорректная сумма');
      await withTransaction(async (client) => {
        const rocket = await client.query('SELECT amount FROM rocket_bankroll WHERE id = 1 FOR UPDATE');
        if (parseFloat(rocket.rows[0].amount) < amt) throw new Error('В кассе Ракеты недостаточно');
        await updateRocketBankroll(-amt);
        await client.query('UPDATE platform_cashbox SET amount = amount + $1, updated_at = NOW() WHERE id = 1', [amt]);
        await client.query(
          `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
           VALUES ('rocket', 'platform', $1, 'Изъятие из кассы Ракеты в главную')`,
          [amt]
        );
      });
    }
    res.json({
      bankroll: await getRocketBankroll(),
      platform_cashbox: parseFloat((await query('SELECT amount FROM platform_cashbox WHERE id = 1')).rows[0].amount)
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/add-pool (из главной кассы в пул Вклада)
router.post('/add-pool', async (req, res) => {
  try {
    const { amount } = req.body;
    const amt = parseFloat(amount);
    if (!validMoney(amt, 0.01)) throw new Error('Некорректная сумма');
    // addManualPool атомарно резервирует сумму из platform_cashbox; запись
    // в журнал переводов обязана быть в той же транзакции, иначе при откате
    // резерва в журнале оставался несуществующий перевод.
    await withTransaction(async (client) => {
      await addManualPool(amt);
      await client.query(
        `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
         VALUES ('platform', 'vault', $1, 'Ручное пополнение ПУЛ ВКЛАДА')`,
        [amt]
      );
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/withdraw-platform — вывод из главной кассы (за пределы проекта)
router.post('/withdraw-platform', async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseFloat(amount);
    if (!validMoney(amt,0.01)) throw new Error('Некорректная сумма');
    await withTransaction(async (client) => {
      const plat = await client.query('SELECT amount FROM platform_cashbox WHERE id = 1 FOR UPDATE');
      if (parseFloat(plat.rows[0].amount) < amt) throw new Error('В главной кассе недостаточно');
      await client.query('UPDATE platform_cashbox SET amount = amount - $1, updated_at = NOW() WHERE id = 1', [amt]);
      await client.query(
        `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
         VALUES ('platform', 'external', $1, $2)`,
        [amt, note || 'Вывод из проекта']
      );
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/seed-platform — быстрое пополнение главной кассы (для демо/теста)
router.post('/seed-platform', async (req, res) => {
  try {
    const { amount } = req.body;
    const amt = parseFloat(amount);
    if (!validMoney(amt,0.01)) throw new Error('Некорректная сумма');
    await withTransaction(async (client) => {
      await client.query('UPDATE platform_cashbox SET amount = amount + $1, updated_at = NOW() WHERE id = 1', [amt]);
      await client.query(
        `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
         VALUES ('seed', 'platform', $1, 'Демо-пополнение')`,
        [amt]
      );
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════
// Выплаты пользователям.
//
// В реальном режиме вывод создаёт заявку со статусом pending (деньги списаны с
// баланса), а оператор отправляет USDT вручную и вносит tx_hash — прежде
// процесс отвечал выдуманным «demo_tx_...» и деньги просто исчезали.
// Статус меняется только из pending одной транзакцией, поэтому ни двойная
// выплата, ни двойной возврат невозможны.
// ════════════════════════════════════════════════════════════════════════

// GET /api/admin/withdrawals?status=pending
router.get('/withdrawals', async (req, res) => {
  try {
    const status = ['pending', 'paid', 'rejected'].includes(String(req.query.status))
      ? String(req.query.status) as 'pending' | 'paid' | 'rejected'
      : undefined;
    res.json(await listWithdrawals(status));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/withdrawals/:id/pay { tx_hash }
router.post('/withdrawals/:id/pay', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!validId(id)) throw new Error('Некорректный ID заявки');
    res.json(await payWithdrawal(id, String(req.body?.tx_hash || '')));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/withdrawals/:id/reject { reason }
router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!validId(id)) throw new Error('Некорректный ID заявки');
    res.json(await rejectWithdrawal(id, req.body?.reason ? String(req.body.reason) : undefined));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/admin/users?search=...&limit=50
router.get('/users', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    const params: any[] = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = 'WHERE u.username ILIKE $1 OR CAST(u.telegram_id AS TEXT) ILIKE $1 OR CAST(u.id AS TEXT) = $2';
      params.push(search);
    }
    const users = await query(
      `SELECT u.id, u.telegram_id, u.username, u.balance, u.frozen_balance,
              u.created_at, u.last_active, u.banned, u.ban_reason, u.referred_by,
              (SELECT COUNT(*) FROM rocket_rounds WHERE user_id = u.id) AS rocket_games,
              (SELECT COALESCE(SUM(bet),0) FROM rocket_rounds WHERE user_id = u.id) AS rocket_bet_sum,
              (SELECT COUNT(*) FROM transactions WHERE user_id = u.id AND type = 'bet' AND game_type='duel') AS duel_games,
              (SELECT COALESCE(SUM(ABS(amount)),0) FROM transactions WHERE user_id = u.id AND type IN ('deposit','demo_deposit')) AS deposits_sum,
              (SELECT COALESCE(SUM(ABS(amount)),0) FROM transactions WHERE user_id = u.id AND type='withdraw') AS withdraws_sum
         FROM users u ${where}
         ORDER BY u.last_active DESC NULLS LAST LIMIT ${limit}`,
      params
    );
    res.json(users.rows.map(r => ({
      id: r.id,
      telegram_id: r.telegram_id,
      username: r.username,
      balance: parseFloat(r.balance),
      frozen_balance: parseFloat(r.frozen_balance),
      created_at: r.created_at,
      last_active: r.last_active,
      banned: r.banned,
      ban_reason: r.ban_reason,
      rocket_games: parseInt(r.rocket_games),
      rocket_bet_sum: parseFloat(r.rocket_bet_sum),
      duel_games: parseInt(r.duel_games),
      deposits_sum: parseFloat(r.deposits_sum),
      withdraws_sum: parseFloat(r.withdraws_sum),
      referred_by: r.referred_by
    })));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Агрегированная статистика игрока — «в плюсе он или в минусе» одним взглядом.
 *
 * Считается по журналу `transactions`, а не по играм: журнал — единственный
 * источник, где видны ВСЕ потоки (игры, дивиденды вклада, реферальные,
 * ручные корректировки админа). Депозиты и выводы в результат НЕ входят — это
 * движение денег, а не прибыль/убыток.
 */
async function buildUserStats(userId: number) {
  const rows = (await query(
    `SELECT type, COALESCE(game_type, 'other') AS game_type,
            COUNT(*)::int AS cnt, COALESCE(SUM(amount), 0) AS sum
       FROM transactions WHERE user_id = $1
      GROUP BY type, game_type`,
    [userId]
  )).rows.map(r => ({ type: r.type, game_type: r.game_type, cnt: Number(r.cnt), sum: parseFloat(r.sum) || 0 }));

  const sumOf = (pred: (r: typeof rows[number]) => boolean) =>
    Math.round(rows.filter(pred).reduce((a, r) => a + r.sum, 0) * 100) / 100;
  const countOf = (pred: (r: typeof rows[number]) => boolean) =>
    rows.filter(pred).reduce((a, r) => a + r.cnt, 0);

  const byGame = (game: string) => {
    const bets = Math.abs(sumOf(r => r.game_type === game && r.type === 'bet'));
    const wins = sumOf(r => r.game_type === game && r.type === 'win');
    return {
      bets: Math.round(bets * 100) / 100,
      wins: Math.round(wins * 100) / 100,
      rounds: countOf(r => r.game_type === game && (r.type === 'bet' || r.type === 'win')),
      net: Math.round((wins - bets) * 100) / 100
    };
  };

  const deposited = sumOf(r => r.type === 'deposit' || r.type === 'demo_deposit');
  const withdrawn = Math.abs(sumOf(r => r.type === 'withdraw'));
  const bets = Math.abs(sumOf(r => r.type === 'bet'));
  const wins = sumOf(r => r.type === 'win');
  const referral = sumOf(r => r.type === 'referral');
  const dividends = sumOf(r => r.type === 'dividend');
  const adjustments = sumOf(r => r.type === 'admin_adjust');
  const gamesNet = Math.round((wins - bets) * 100) / 100;
  const totalNet = Math.round((gamesNet + referral + dividends + adjustments) * 100) / 100;

  return {
    deposited, withdrawn, bets, wins, referral, dividends, adjustments,
    /** Итог только по играм: >0 — игрок выигрывает у платформы */
    games_net: gamesNet,
    /** Итог со всеми начислениями (игры + дивиденды + рефералы + корректировки) */
    total_net: totalNet,
    games: { rocket: byGame('rocket'), duel: byGame('duel'), safe: byGame('safe'), vault: byGame('vault') }
  };
}

/** Рефералы конкретного игрока — по именам, с их оборотом. */
async function buildReferrals(userId: number) {
  // Один запрос с LEFT JOIN вместо подзапроса на каждого реферала: прежний
  // вариант `getReferralStats()` делал N+1 обращений к БД и на рефоводе с
  // сотней приглашённых подвешивал карточку пользователя.
  //
  // Ставки пишутся отрицательными, поэтому «оборот» считаем арифметикой, а не
  // через abs(): так запрос не зависит от того, реализована ли функция для
  // конкретного числового типа (в тестовой in-memory БД её нет).
  const rows = await query(
    `SELECT u.id, u.username, u.created_at, u.banned,
            COALESCE(SUM(CASE WHEN t.type = 'bet' THEN (CASE WHEN t.amount < 0 THEN -t.amount ELSE t.amount END) ELSE 0 END), 0) AS total_bets,
            COALESCE(SUM(CASE WHEN t.type = 'bet' THEN 1 ELSE 0 END), 0)::int AS bets_count
       FROM users u
       LEFT JOIN transactions t ON t.user_id = u.id
      WHERE u.referred_by = $1
      GROUP BY u.id, u.username, u.created_at, u.banned
      ORDER BY u.id DESC`,
    [userId]
  );
  const inviter = await query(
    `SELECT p.id, p.username FROM users p JOIN users c ON c.referred_by = p.id WHERE c.id = $1`,
    [userId]
  );
  const earned = await query(
    `SELECT COALESCE(SUM(amount), 0) AS earned FROM transactions WHERE user_id = $1 AND type = 'referral'`,
    [userId]
  );
  const referralPercent = parseFloat((await getSetting('referral_percent')) || '3');
  return {
    invited_by: inviter.rows[0] || null,
    /** Сколько игрок получил реферальных начислений (точные данные из журнала) */
    earned_total: Math.round((parseFloat(earned.rows[0].earned) || 0) * 100) / 100,
    referral_percent: referralPercent,
    count: rows.rows.length,
    list: rows.rows.map(r => {
      const bets = Math.round((parseFloat(r.total_bets) || 0) * 100) / 100;
      return {
        id: r.id,
        username: r.username,
        created_at: r.created_at,
        banned: !!r.banned,
        bets_count: Number(r.bets_count),
        total_bets: bets,
        /** Оценка начислений рефоводу с этого реферала по текущему проценту */
        earned_from: Math.round(bets * (referralPercent / 100) * 100) / 100
      };
    })
  };
}

// GET /api/admin/users/:id — детальная инфа
router.get('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new Error('Некорректный ID пользователя');
    const u = (await query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
    if (!u) return res.status(404).json({ error: 'не найден' });
    const txs = await query(
      `SELECT * FROM transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 100`, [id]
    );
    const rockets = await query(
      `SELECT * FROM rocket_rounds WHERE user_id = $1 ORDER BY id DESC LIMIT 50`, [id]
    );
    const duels = await query(
      `SELECT d.*, uc.username AS creator_name, uo.username AS opponent_name
         FROM duels d JOIN users uc ON uc.id = d.creator_id LEFT JOIN users uo ON uo.id = d.opponent_id
         WHERE d.creator_id = $1 OR d.opponent_id = $1 ORDER BY d.id DESC LIMIT 50`,
      [id]
    );
    const safes = await query(
      `SELECT sd.*, s.date, s.status FROM safe_deposits sd
         JOIN safes s ON s.id = sd.safe_id WHERE sd.user_id = $1 ORDER BY sd.id DESC LIMIT 50`,
      [id]
    );
    // «Где деньги»: сколько вложено в сейф и во вклад VAULT. Без этого админ
    // на жалобу «деньги пропали» видел только баланс и заморозку дуэлей
    const locked = await getBalanceSnapshot(id);
    res.json({
      user: {
        id: u.id,
        telegram_id: u.telegram_id,
        username: u.username,
        balance: parseFloat(u.balance),
        frozen_balance: parseFloat(u.frozen_balance),
        safe_locked: locked.safe_locked,
        vault_locked: locked.vault_locked,
        withdraw_address: u.withdraw_address,
        deposit_address: u.deposit_address,
        auto_safe_percent: u.auto_safe_percent,
        ref_code: u.ref_code,
        referred_by: u.referred_by,
        created_at: u.created_at,
        last_active: u.last_active,
        banned: u.banned,
        ban_reason: u.ban_reason,
        pin_set: !!u.pin_hash
      },
      transactions: txs.rows.map(r => ({
        ...r,
        amount: parseFloat(r.amount),
        balance_after: parseFloat(r.balance_after)
      })),
      rockets: rockets.rows.map(r => ({ ...r, bet: parseFloat(r.bet), profit: parseFloat(r.profit), crash_at: parseFloat(r.crash_at) })),
      duels: duels.rows.map(r => ({ ...r, amount: parseFloat(r.amount) })),
      safes: safes.rows.map(r => ({ ...r, amount: parseFloat(r.amount), prize: parseFloat(r.prize) })),
      // Задачи админки: подробная статистика игрока (в плюсе/минусе) и его рефералы
      stats: await buildUserStats(id),
      referrals: await buildReferrals(id)
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new Error('Некорректный ID пользователя');
    const { reason } = req.body;
    await query('UPDATE users SET banned = TRUE, ban_reason = $2 WHERE id = $1', [id, reason || '']);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new Error('Некорректный ID пользователя');
    await query('UPDATE users SET banned = FALSE, ban_reason = NULL WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/users/:id/adjust — поправить баланс (напр. ручной возврат)
router.post('/users/:id/adjust', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new Error('Некорректный ID пользователя');
    const { delta, reason } = req.body;
    const d = parseFloat(delta);
    if (!Number.isFinite(d) || Math.round(d*100)!==d*100 || Math.abs(d)>10000000) throw new Error('Некорректная сумма');
    const { modifyBalance } = await import('../../services/balance');
    await modifyBalance(id, d, 'admin_adjust', { description: reason || 'Корректировка админом' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/admin/settings
router.get('/settings', async (_req, res) => {
  const keys = [
    'commission_percent', 'withdraw_commission', 'referral_percent',
    'min_bet', 'rocket_max_bet_percent', 'vault_pool_percent',
    'safe_min_bank', 'safe_min_participants', 'beautiful_flight_chance',
    'vault_min_deposit', 'vault_max_floor', 'vault_max_multiplier',
    'safe_crack_hour', 'safe_crack_minute', 'safe_crack_timeout_minutes', 'safe_drum_speed_multiplier',
    'project_start_date'
  ];
  const defaults: Record<string, string> = {
    commission_percent: '10', withdraw_commission: '1', referral_percent: '3',
    min_bet: '1', rocket_max_bet_percent: '100', vault_pool_percent: '15',
    safe_min_bank: '25', safe_min_participants: '2', beautiful_flight_chance: '3',
    vault_min_deposit: '10', vault_max_floor: '100', vault_max_multiplier: '10',
    safe_crack_hour: '18', safe_crack_minute: '0', safe_crack_timeout_minutes: '1', safe_drum_speed_multiplier: '1',
    project_start_date: '2026-01-01'
  };
  const out: Record<string, string> = {};
  const labels: Record<string, string> = {
    commission_percent: 'Комиссия игр (%)',
    withdraw_commission: 'Комиссия вывода (%)',
    referral_percent: 'Реферальный процент (%)',
    min_bet: 'Минимальная ставка ($)',
    rocket_max_bet_percent: 'Макс. ставка Ракеты (% от кассы, 0 — без лимита)',
    vault_pool_percent: 'Отчисления в ПУЛ ВКЛАД (%)',
    safe_min_bank: 'Мин. банк Сейфа ($)',
    safe_min_participants: 'Мин. участников Сейфа',
    beautiful_flight_chance: 'Шанс красивого полёта (%) — внутренняя настройка',
    vault_min_deposit: 'Мин. вклад ВАУЛЬТ ($)',
    vault_max_floor: 'Минимальный максимум вклада ($)',
    vault_max_multiplier: 'Максимум: множитель вчерашнего пула',
    safe_crack_hour: 'Час взлома сейфа МСК (0-23)',
    safe_crack_minute: 'Минута взлома сейфа (0-59)',
    safe_crack_timeout_minutes: 'Нужно взломать сейф за (минуты)',
    safe_drum_speed_multiplier: 'Скорость барабанов (×, по умолчанию 1)',
    project_start_date: 'Дата старта проекта (ГГГГ-ММ-ДД)'
  };
  // Группы — чтобы настройки в админке не шли сплошным списком
  const groups = [
    { title: '🔒 Сейф', keys: ['safe_crack_hour', 'safe_crack_minute', 'safe_crack_timeout_minutes', 'safe_drum_speed_multiplier', 'safe_min_bank', 'safe_min_participants'] },
    { title: '🚀 Ракета', keys: ['rocket_max_bet_percent', 'beautiful_flight_chance', 'min_bet'] },
    { title: '💎 Вклад (VAULT)', keys: ['vault_pool_percent', 'vault_min_deposit', 'vault_max_floor', 'vault_max_multiplier'] },
    { title: '💰 Комиссии и рефералы', keys: ['commission_percent', 'withdraw_commission', 'referral_percent'] },
    { title: '📊 Проект', keys: ['project_start_date'] }
  ];
  for (const k of keys) out[k] = (await getSetting(k)) || defaults[k] || '';
  res.json({ values: out, labels, groups });
});

// POST /api/admin/settings
router.post('/settings', async (req, res) => {
  try {
    const ranges:Record<string,[number,number]>={commission_percent:[0,50],withdraw_commission:[0,20],referral_percent:[0,50],min_bet:[0.01,1000000],rocket_max_bet_percent:[0,1000000],vault_pool_percent:[0,100],safe_min_bank:[0,10000000],safe_min_participants:[1,100000],beautiful_flight_chance:[0,100],vault_min_deposit:[0.01,10000000],vault_max_floor:[0.01,10000000],vault_max_multiplier:[0.01,1000],safe_crack_hour:[0,23],safe_crack_minute:[0,59],safe_crack_timeout_minutes:[0.1,1440],safe_drum_speed_multiplier:[0.1,10]};
    for (const [k,v] of Object.entries(req.body)) {
      if(k==='project_start_date') { if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error('Некорректная дата'); }
      else { const range=ranges[k],n=Number(v); if(!range||!Number.isFinite(n)||n<range[0]||n>range[1]) throw new Error(`Некорректная настройка: ${k}`); }
      await setSetting(k,String(v));
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/admin/transactions?type=&from=&to=&userId=
router.get('/transactions', async (req, res) => {
  try {
    const page = parseInt(String(req.query.page || '0')) || 0;
    const pageSize = 50;
    const type = String(req.query.type || '');
    const userId = req.query.userId ? parseInt(String(req.query.userId)) : null;
    const from = req.query.from ? new Date(String(req.query.from) + 'T00:00:00') : null;
    const to = req.query.to ? new Date(String(req.query.to) + 'T23:59:59.999') : null;

    const where: string[] = [];
    const params: any[] = [];
    if (type) { params.push(type); where.push(`t.type = $${params.length}`); }
    if (userId) { params.push(userId); where.push(`t.user_id = $${params.length}`); }
    if (from && to) { params.push(from, to); where.push(`t.created_at BETWEEN $${params.length-1} AND $${params.length}`); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = (await query(`SELECT COUNT(*) FROM transactions t ${whereSql}`, params)).rows[0].count;
    params.push(pageSize, page * pageSize);
    const rows = await query(
      `SELECT t.*, u.username FROM transactions t JOIN users u ON u.id = t.user_id
         ${whereSql} ORDER BY t.id DESC
         LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );
    res.json({
      total: parseInt(total),
      page, pageSize,
      items: rows.rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        username: r.username,
        type: r.type,
        amount: parseFloat(r.amount),
        balance_after: parseFloat(r.balance_after),
        game_type: r.game_type,
        description: r.description,
        created_at: r.created_at
      }))
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Антифрод: общие устройства/IP и ручная проверка флагов.
router.get('/antifraud', async (req,res) => {
  const status=String(req.query.status||'open');
  const rows=await query(`SELECT f.*,u.username,u.telegram_id FROM antifraud_flags f JOIN users u ON u.id=f.user_id WHERE f.status=$1 ORDER BY f.risk_score DESC,f.id DESC LIMIT 500`,[status]);
  res.json(rows.rows);
});
router.post('/antifraud/:id/review', async (req,res) => {
  if(!validId(req.params.id)||!['resolved','confirmed','open'].includes(String(req.body.status))) return res.status(400).json({error:'Некорректные данные'});
  await query(`UPDATE antifraud_flags SET status=$1,reviewed_at=NOW() WHERE id=$2`,[req.body.status,Number(req.params.id)]);
  res.json({ok:true});
});
router.get('/audit-log', async (_req,res) => {
  const rows=await query(`SELECT a.*,u.username actor FROM admin_audit_log a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.id DESC LIMIT 500`);
  res.json(rows.rows);
});

export default router;
