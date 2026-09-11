import { Router } from 'express';
import { auth } from '../middleware/auth';
import { placeBet, getRocketHistory, getRocketBankroll, processCrash } from '../../services/rocket';

const router = Router();

// POST /api/rocket/start — сделать ставку, начать раунд
router.post('/start', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { bet } = req.body;
    const result = await placeBet(user.id, parseFloat(bet));
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/rocket/history
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(await getRocketHistory(limit));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/rocket/bankroll
router.get('/bankroll', async (_req, res) => {
  try {
    res.json({ bankroll: await getRocketBankroll() });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
