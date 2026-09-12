import { Router } from 'express';
import { auth } from '../middleware/auth';
import {
  getActiveSafe, safeDeposit, cancelSafeDeposit, submitCrackTime,
  getSafeResults, getUserSafeDeposit, getSafeById,
  getCrackWindowMs, getCrackRemainingMs, getPendingCracksCount
} from '../../services/safe';
import { nextMSK } from '../../utils/time';

const router = Router();

// GET /api/safe/current
router.get('/current', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const safe = await getActiveSafe();
    if (!safe) return res.json({ safe: null, my_deposit: null });
    const myDeposit = await getUserSafeDeposit(safe.id, user.id);
    // Время до взлома — читается из настроек (час/минута в МСК)
    const { getSetting } = await import('../../services/revenue');
    const hour = parseInt((await getSetting('safe_crack_hour')) || '21');
    const minute = parseInt((await getSetting('safe_crack_minute')) || '0');
    const crackAt = nextMSK(hour, minute);
    const now = new Date();
    const timeToCrack = Math.max(0, crackAt.getTime() - now.getTime());

    // Во время взлома клиенту нужно знать длину окна и остаток (считается на
    // сервере от crack_started_at — клиентские часы могут врать)
    const isCracking = safe.status === 'cracking';
    const crackWindowMs = isCracking ? await getCrackWindowMs() : null;
    const crackRemainingMs = isCracking ? await getCrackRemainingMs(safe.id, crackWindowMs ?? undefined) : null;
    const pendingCracks = isCracking ? await getPendingCracksCount(safe.id) : null;

    res.json({
      safe: {
        id: safe.id,
        bank: safe.bank,
        prize_pool: safe.prize_pool,
        participants_count: safe.participants_count,
        winners_count: safe.winners_count,
        status: safe.status,
        code: safe.status === 'cracking' || safe.status === 'finished' ? safe.code : null,
        drum_speeds: safe.drum_speeds,
        date: safe.date,
        crack_at: crackAt.toISOString(),
        time_to_crack_ms: isCracking ? (crackRemainingMs ?? 0) : timeToCrack,
        crack_window_ms: crackWindowMs,
        crack_remaining_ms: crackRemainingMs,
        pending_cracks: pendingCracks
      },
      my_deposit: myDeposit
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/safe/deposit
router.post('/deposit', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { amount } = req.body;
    res.json(await safeDeposit(user.id, parseFloat(amount)));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/safe/cancel
router.post('/cancel', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    res.json(await cancelSafeDeposit(user.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/safe/crack
router.post('/crack', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { time_ms } = req.body;
    const t = Number(time_ms);
    if (!Number.isFinite(t) || t < 0) throw new Error('Некорректное время взлома');
    res.json(await submitCrackTime(user.id, t));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/safe/results/:id
router.get('/results/:id', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new Error('Некорректный ID сейфа');
    const results = await getSafeResults(id);
    res.json({ results, my_user_id: user.id });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/safe/:id (replay)
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new Error('Некорректный ID сейфа');
    const safe = await getSafeById(id);
    if (!safe) return res.status(404).json({ error: 'Не найдено' });
    res.json(safe);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
