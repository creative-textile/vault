import { Router } from 'express';
import { auth } from '../middleware/auth';
import { authenticateTelegram, getProfile, getTransactionHistory, updateSettings } from '../../services/user';
import { getSetting } from '../../services/revenue';

const router = Router();

// GET /api/config — публичная конфигурация для клиента (минимумы и т.п.)
router.get('/config', async (_req, res) => {
  const [minBet, safeMinBank, safeMinPart, rocketMaxPct, vaultMin, vaultMaxBase] = await Promise.all([
    getSetting('min_bet'),
    getSetting('safe_min_bank'),
    getSetting('safe_min_participants'),
    getSetting('rocket_max_bet_percent'),
    getSetting('vault_min_deposit'),
    getSetting('vault_max_deposit')
  ]);
  res.json({
    min_bet: parseFloat(minBet || '1'),
    safe_min_bank: parseFloat(safeMinBank || '5'),
    safe_min_participants: parseInt(safeMinPart || '2'),
    rocket_max_bet_percent: parseInt(rocketMaxPct || '50'),
    vault_min_deposit_base: parseFloat(vaultMin || '10'),
    vault_max_deposit_base: parseFloat(vaultMaxBase || '100')
  });
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
