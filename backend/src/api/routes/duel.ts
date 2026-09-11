import { Router } from 'express';
import { auth } from '../middleware/auth';
import { createDuel, getLobby, acceptDuel, cancelDuel, getDuelHistory, getDuel } from '../../services/duel';
import { notify } from '../../services/notifications';

const router = Router();

// POST /api/duel/create
router.post('/create', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { amount } = req.body;
    const result = await createDuel(user.id, parseFloat(amount));
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/duel/lobby
router.get('/lobby', async (_req, res) => {
  try {
    res.json(await getLobby());
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/duel/pending — есть ли для текущего пользователя не просмотренная дуэль
router.get('/pending', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const r = await import('../../db/pool');
    // Ищет последнюю завершённую дуэль, где пользователь — участник
    const res2 = await r.query(
      `SELECT * FROM duels
       WHERE status = 'finished'
       AND (creator_id = $1 OR opponent_id = $1)
       AND finished_at > NOW() - INTERVAL '1 day'
       ORDER BY finished_at DESC LIMIT 1`,
      [user.id]
    );
    if (res2.rows.length === 0) return res.json({ pending: null });
    const d = res2.rows[0];
    const amount = parseFloat(d.amount);
    const prize = Math.round(amount * 2 * 0.9 * 100) / 100;
    res.json({
      pending: {
        id: d.id,
        amount,
        result: d.result,
        winner_id: d.winner_id,
        prize,
        coin_trajectory: d.coin_trajectory,
        creator_id: d.creator_id,
        opponent_id: d.opponent_id,
        i_won: d.winner_id === user.id,
        finished_at: d.finished_at
      }
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/duel/accept/:id
router.post('/accept/:id', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params.id);
    const result = await acceptDuel(id, user.id);
    notify(result.creator_id, `⚔️ Вызов на $${await getDuel(id).then(d => d?.amount)} принят!`);
    notify(user.id, `⚔️ Вы приняли вызов. Результат: ${result.result === 'heads' ? 'орёл' : 'решка'}`);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/duel/cancel/:id
router.post('/cancel/:id', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params.id);
    res.json(await cancelDuel(id, user.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/duel/history
router.get('/history', async (_req, res) => {
  try {
    res.json(await getDuelHistory());
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/duel/:id (replay)
router.get('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const d = await getDuel(id);
    if (!d) return res.status(404).json({ error: 'Не найдено' });
    const user = (req as any).user;
    const amount = parseFloat(d.amount);
    const prize = Math.round(amount * 2 * 0.9 * 100) / 100;
    const i_won = d.winner_id === user.id;
    res.json({
      id: d.id,
      result: d.result,
      winner: d.winner_id,
      winner_id: d.winner_id,
      prize,
      amount,
      coin_trajectory: d.coin_trajectory,
      creator_id: d.creator_id,
      opponent_id: d.opponent_id,
      i_won,
      finished_at: d.finished_at,
      status: d.status
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
