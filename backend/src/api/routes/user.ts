import { Router } from 'express';
import { auth } from '../middleware/auth';
import { authenticateTelegram, getProfile, getTransactionHistory, updateSettings } from '../../services/user';
import { getSetting } from '../../services/revenue';
import { query } from '../../db/pool';
import { config } from '../../config';

const router = Router();

/**
 * GET /api/config — публичная конфигурация для клиента (минимумы и т.п.).
 *
 * `demo_mode` обязателен на клиенте: карточка демо-пополнения больше не
 * рисуется «всегда» (раньше в реальном режиме она показывала кнопку, а сервер
 * отвечал 403 — теперь её просто нет).
 */
router.get('/config', async (_req, res) => {
  const [minBet, safeMinBank, safeMinPart, rocketMaxPct, vaultMin, vaultMaxBase, safeMult, withdrawComm] = await Promise.all([
    getSetting('min_bet'),
    getSetting('safe_min_bank'),
    getSetting('safe_min_participants'),
    getSetting('rocket_max_bet_percent'),
    getSetting('vault_min_deposit'),
    getSetting('vault_max_floor'),
    getSetting('safe_payout_multiplier'),
    getSetting('withdraw_commission')
  ]);
  res.json({
    min_bet: parseFloat(minBet || '1'),
    safe_min_bank: parseFloat(safeMinBank || '25'),
    safe_min_participants: parseInt(safeMinPart || '2'),
    rocket_max_bet_percent: parseInt(rocketMaxPct || '50'),
    vault_min_deposit_base: parseFloat(vaultMin || '10'),
    vault_max_deposit_base: parseFloat(vaultMaxBase || '100'),
    safe_payout_multiplier: parseFloat(safeMult || '1.5'),
    withdraw_commission: parseFloat(withdrawComm || '1'),
    demo_mode: config.demoMode,
    bot_username: config.botUsername
  });
});

/**
 * GET /api/stats/summary — витрина проекта для главного экрана:
 * сколько участников, сколько дней работаем, сколько пополнено и выплачено.
 * Дата старта задаётся в админке (project_start_date), по умолчанию 2026-01-01.
 */
router.get('/stats/summary', async (_req, res) => {
  try {
    const startRaw = (await getSetting('project_start_date')) || '2026-01-01';
    const start = new Date(`${startRaw}T00:00:00Z`);
    const days = Number.isFinite(start.getTime())
      ? Math.max(1, Math.floor((Date.now() - start.getTime()) / 86400000) + 1)
      : 1;

    const [users, deposited, withdrawn] = await Promise.all([
      query(`SELECT COUNT(*)::int AS c FROM users`),
      query(`SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE type IN ('deposit', 'demo_deposit')`),
      // Выводы хранятся отрицательными; CASE вместо ABS() — переносимее
      query(`SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE amount END), 0) AS s
               FROM transactions WHERE type = 'withdraw'`)
    ]);

    res.json({
      users_count: users.rows[0]?.c || 0,
      days_working: days,
      project_start: startRaw,
      total_deposited: Math.round(parseFloat(deposited.rows[0]?.s || '0') * 100) / 100,
      total_withdrawn: Math.round(parseFloat(withdrawn.rows[0]?.s || '0') * 100) / 100
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/telegram — авторизация
router.post('/auth/telegram', async (req, res) => {
  try {
    const { initData, refCode } = req.body;
    const result = await authenticateTelegram(initData, refCode);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    res.json(await getProfile(user.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// PATCH /api/profile (настройки)
router.patch('/profile', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    await updateSettings(user.id, req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/transactions
router.get('/transactions', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(await getTransactionHistory(user.id, limit));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
