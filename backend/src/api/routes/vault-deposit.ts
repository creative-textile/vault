import { Router } from 'express';
import { auth } from '../middleware/auth';
import { moneyBody } from '../middleware/security';
import { query } from '../../db/pool';
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

// GET /api/vault/accruals — фактические календарные начисления текущего игрока
router.get('/accruals', auth, async (req, res) => {
  try {
    const user=(req as any).user;
    const rows=await query(`SELECT a.id,a.deposit_id,a.date,a.pool_amount,a.profit,a.created_at,
      d.amount,d.term_days,d.multiplier FROM vault_deposit_accruals a
      JOIN vault_deposits d ON d.id=a.deposit_id WHERE a.user_id=$1
      ORDER BY a.date DESC,a.id DESC LIMIT 90`,[user.id]);
    res.json(rows.rows.map((x:any)=>({...x,pool_amount:Number(x.pool_amount),profit:Number(x.profit),amount:Number(x.amount),multiplier:Number(x.multiplier)})));
  } catch(e:any) { res.status(400).json({error:e.message}); }
});

// POST /api/vault/lock
router.post('/lock', auth, moneyBody('amount',0.01), async (req, res) => {
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
