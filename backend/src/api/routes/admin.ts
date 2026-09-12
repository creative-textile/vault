import { Router } from 'express';
import { auth, adminOnly } from '../middleware/auth';
import { query } from '../../db/pool';
import { getSetting, setSetting } from '../../services/revenue';
import { getRocketBankroll, updateRocketBankroll } from '../../services/rocket';
import { addManualPool, getVaultPool } from '../../services/vault-deposit';
import { startCracking, finalizeCracking, getTodaySafe } from '../../services/safe';
import { broadcast } from '../../services/notifications';

const router = Router();

router.use(auth, adminOnly);

function rangeDates(from: string, to: string) {
  return { from: new Date(from + 'T00:00:00'), to: new Date(to + 'T23:59:59.999') };
}

const defaultRange = () => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from, to: new Date(to.getTime()) };
};

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
        max_deposit: await getSetting('vault_max_deposit')
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
    if (add) {
      const amt = parseFloat(add);
      // перевод platform -> rocket
      const plat = await query('SELECT amount FROM platform_cashbox WHERE id = 1 FOR UPDATE');
      if (parseFloat(plat.rows[0].amount) < amt) throw new Error('В главной кассе недостаточно');
      await query('UPDATE platform_cashbox SET amount = amount - $1, updated_at = NOW() WHERE id = 1', [amt]);
      await updateRocketBankroll(amt);
      await query(
        `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
         VALUES ('platform', 'rocket', $1, 'Ручное пополнение кассы Ракеты')`,
        [amt]
      );
    }
    if (withdraw) {
      const amt = parseFloat(withdraw);
      if (await getRocketBankroll() < amt) throw new Error('В кассе Ракеты недостаточно');
      await updateRocketBankroll(-amt);
      await query('UPDATE platform_cashbox SET amount = amount + $1, updated_at = NOW() WHERE id = 1', [amt]);
      await query(
        `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
         VALUES ('rocket', 'platform', $1, 'Изъятие из кассы Ракеты в главную')`,
        [amt]
      );
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
    const plat = await query('SELECT amount FROM platform_cashbox WHERE id = 1 FOR UPDATE');
    if (parseFloat(plat.rows[0].amount) < amt) throw new Error('В главной кассе недостаточно');
    await query('UPDATE platform_cashbox SET amount = amount - $1, updated_at = NOW() WHERE id = 1', [amt]);
    await addManualPool(amt);
    await query(
      `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
       VALUES ('platform', 'vault', $1, 'Ручное пополнение ПУЛ ВКЛАДА')`,
      [amt]
    );
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
    const plat = await query('SELECT amount FROM platform_cashbox WHERE id = 1 FOR UPDATE');
    if (parseFloat(plat.rows[0].amount) < amt) throw new Error('В главной кассе недостаточно');
    await query('UPDATE platform_cashbox SET amount = amount - $1, updated_at = NOW() WHERE id = 1', [amt]);
    await query(
      `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
       VALUES ('platform', 'external', $1, $2)`,
      [amt, note || 'Вывод из проекта']
    );
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
    await query('UPDATE platform_cashbox SET amount = amount + $1, updated_at = NOW() WHERE id = 1', [amt]);
    await query(
      `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
       VALUES ('seed', 'platform', $1, 'Демо-пополнение')`,
      [amt]
    );
    res.json({ ok: true });
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
              (SELECT COALESCE(SUM(ABS(amount)),0) FROM transactions WHERE user_id = u.id AND type='deposit') AS deposits_sum,
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
    res.json({
      user: {
        id: u.id,
        telegram_id: u.telegram_id,
        username: u.username,
        balance: parseFloat(u.balance),
        frozen_balance: parseFloat(u.frozen_balance),
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
      safes: safes.rows.map(r => ({ ...r, amount: parseFloat(r.amount), prize: parseFloat(r.prize) }))
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
    'vault_min_deposit', 'vault_max_deposit',
    'safe_crack_hour', 'safe_crack_minute', 'safe_crack_timeout_minutes'
  ];
  const defaults: Record<string, string> = {
    commission_percent: '10', withdraw_commission: '1', referral_percent: '3',
    min_bet: '1', rocket_max_bet_percent: '50', vault_pool_percent: '15',
    safe_min_bank: '25', safe_min_participants: '2', beautiful_flight_chance: '3',
    vault_min_deposit: '10', vault_max_deposit: '100',
    safe_crack_hour: '21', safe_crack_minute: '0', safe_crack_timeout_minutes: '2'
  };
  const out: Record<string, string> = {};
  const labels: Record<string, string> = {
    commission_percent: 'Комиссия игр (%)',
    withdraw_commission: 'Комиссия вывода (%)',
    referral_percent: 'Реферальный процент (%)',
    min_bet: 'Минимальная ставка ($)',
    rocket_max_bet_percent: 'Макс. ставка Ракеты (% от кассы)',
    vault_pool_percent: 'Отчисления в ПУЛ ВКЛАД (%)',
    safe_min_bank: 'Мин. банк Сейфа ($)',
    safe_min_participants: 'Мин. участников Сейфа',
    beautiful_flight_chance: 'Шанс красивого полёта (%)',
    vault_min_deposit: 'Мин. вклад ВАУЛЬТ ($)',
    vault_max_deposit: 'Начальный макс. вклад ВАУЛЬТ ($)',
    safe_crack_hour: 'Час взлома сейфа МСК (0-23)',
    safe_crack_minute: 'Минута взлома сейфа (0-59)',
    safe_crack_timeout_minutes: 'Дедлайн взлома сейфа (минуты)'
  };
  for (const k of keys) out[k] = (await getSetting(k)) || defaults[k] || '';
  res.json({ values: out, labels });
});

// POST /api/admin/settings
router.post('/settings', async (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body)) {
      await setSetting(k, String(v));
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/start-cracking - ручной запуск взлома сейфа.
// Из админ-панели кнопка убрана (взлом стартует по настроенному времени МСК),
// эндпоинт оставлен для отладки/ops через curl и для смоук-тестов.
router.post('/start-cracking', async (req, res) => {
  try {
    const safe = await getTodaySafe();
    if (!safe) return res.status(400).json({ error: 'Сейф не создан' });
    if (safe.status !== 'collecting') return res.status(400).json({ error: 'Сейф не в фазе сбора' });
    
    const resCrack = await startCracking();
    if (!resCrack || resCrack.cancelled) {
      broadcast('safe_cancelled', {});
      return res.json({ ok: false, message: 'Сейф отменён (не набрал минимум)' });
    }
    if (!resCrack.started) {
      return res.json({ ok: false, message: 'Взлом уже идёт или сейф разыгран' });
    }

    broadcast('safe_crack_started', { safe: resCrack.safe, window_ms: resCrack.window_ms });

    // Итоги подводит сам сервис: досрочно — как только результат сдали все
    // участники, иначе по истечении дедлайна safe_crack_timeout_minutes.
    res.json({ ok: true, message: 'Взлом запущен', window_ms: resCrack.window_ms });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/finalize-cracking - досрочно закрыть окно взлома и подвести итоги
router.post('/finalize-cracking', async (_req, res) => {
  try {
    const safeId = await finalizeCracking();
    if (!safeId) return res.status(400).json({ error: 'Взлом сейчас не идёт' });
    res.json({ ok: true, safe_id: safeId });
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

export default router;
