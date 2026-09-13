import { Router } from 'express';
import { auth } from '../middleware/auth';
import { moneyBody, pinBody } from '../middleware/security';
import { config } from '../../config';
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

/**
 * DEMO: POST /api/wallet/demo-deposit { amount }
 *
 * Эндпоинт существует ТОЛЬКО при DEMO_MODE=true — в реальном режиме отвечает
 * 403 и не трогает баланс. Прежде режим не проверялся ни здесь, ни в сервисе,
 * поэтому любой залогиненный пользователь мог начислить себе до $10 000 000
 * одним запросом.
 */
router.post('/demo-deposit', auth, moneyBody('amount',2), async (req, res) => {
  if (!config.demoMode) return res.status(403).json({ error: 'Демо-пополнение отключено' });
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
router.post('/withdraw', auth, moneyBody('amount',5), pinBody, async (req, res) => {
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
router.post('/set-pin', auth, pinBody, async (req, res) => {
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
