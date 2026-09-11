import { Router } from 'express';
import { auth } from '../middleware/auth';
import { getOrCreateDepositAddress, demoDeposit, processWithdrawal, setPin, setWithdrawAddress } from '../../services/ton';

const router = Router();

// GET /api/wallet/deposit-address
router.get('/deposit-address', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const addr = await getOrCreateDepositAddress(user.id);
    res.json({ address: addr });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// DEMO: POST /api/wallet/demo-deposit { amount }
router.post('/demo-deposit', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { amount } = req.body;
    const result = await demoDeposit(user.id, parseFloat(amount));
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/wallet/withdraw
router.post('/withdraw', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { amount, pin, address } = req.body;
    if (address) await setWithdrawAddress(user.id, address);
    const result = await processWithdrawal(user.id, parseFloat(amount), pin || '', address);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/wallet/set-pin
router.post('/set-pin', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { pin } = req.body;
    await setPin(user.id, pin);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/wallet/set-withdraw-address
router.post('/set-withdraw-address', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { address } = req.body;
    await setWithdrawAddress(user.id, address);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
