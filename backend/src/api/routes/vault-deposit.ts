import { Router } from 'express';
import { auth } from '../middleware/auth';
import {
  lockVaultDeposit, getActiveDeposit, earlyUnlock,
  getVaultHistory, getPoolInfo, addManualPool
} from '../../services/vault-deposit';

const router = Router();

// GET /api/vault/status
router.get('/status', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const [deposit, history, pool] = await Promise.all([
      getActiveDeposit(user.id),
      getVaultHistory(user.id, 10),
      getPoolInfo()
    ]);
    res.json({ active_deposit: deposit, history, pool_info: pool });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/vault/lock
router.post('/lock', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { amount, term_days } = req.body;
    res.json(await lockVaultDeposit(user.id, parseFloat(amount), parseInt(term_days)));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/vault/early-unlock
router.post('/early-unlock', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { deposit_id } = req.body;
    const id = parseInt(deposit_id);
    if (isNaN(id)) throw new Error('Некорректный ID депозита');
    res.json(await earlyUnlock(user.id, id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/vault/history
router.get('/history', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    res.json(await getVaultHistory(user.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
