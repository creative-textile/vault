import { Router } from 'express';
import { auth } from '../middleware/auth';
import { moneyBody } from '../middleware/security';
import { placeBet, getRocketHistory, getRocketLimits, publicRocketLimits } from '../../services/rocket';
import { getReplay } from '../../services/replay';

const router = Router();

// POST /api/rocket/start — сделать ставку, начать раунд
router.post('/start', auth, moneyBody('bet',0.01), async (req, res) => {
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

// GET /api/rocket/replay/:id — тот же единый публичный replay JSON.
router.get('/replay/:id', async (req,res) => {
  const id=Number(req.params.id); const replay=Number.isInteger(id) ? await getReplay('rocket',id) : null;
  if(!replay) return res.status(404).json({error:'Реплей не найден'});
  res.json(replay);
});

/**
 * GET /api/rocket/bankroll — лимиты ставки (путь сохранён для совместимости).
 *
 * Максимальная ставка — процент от кассы, а касса меняется после каждой ставки
 * и каждого выигрыша, поэтому подпись «Макс: $N» обязана пересчитываться, а не
 * висеть значением, полученным один раз при монтировании экрана.
 *
 * Самого размера кассы в ответе НЕТ: это админская цифра, игроку достаточно
 * готового `max_bet` (см. `publicRocketLimits()`). Админка берёт кассу из
 * `/api/admin/stats`.
 *
 * `max_bet: null` означает, что лимита нет (настройка `rocket_max_bet_percent = 0`).
 */
router.get('/bankroll', async (_req, res) => {
  try {
    res.json(publicRocketLimits(await getRocketLimits()));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
