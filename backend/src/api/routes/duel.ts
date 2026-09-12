import { Router } from 'express';
import { auth } from '../middleware/auth';
import { createDuel, getLobby, acceptDuel, cancelDuel, getDuelHistory, getDuel } from '../../services/duel';
import { notify, notifyDuelResult, getUnreadUserNotifications } from '../../services/notifications';
import { markNotificationAsRead, getUnreadCount } from '../../services/user-notifications';

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
    // Убираем ограничение по времени, чтобы показывать все непросмотренные дуэли
    const res2 = await r.query(
      `SELECT * FROM duels
       WHERE status = 'finished'
       AND (creator_id = $1 OR opponent_id = $1)
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
    if (isNaN(id)) throw new Error('Некорректный ID дуэли');
    const duel = await getDuel(id);
    if (!duel) throw new Error('Дуэль не найдена');
    
    const result = await acceptDuel(id, user.id);
    
    // Уведомляем создателя дуэли
    const amount = parseFloat(duel.amount);
    const prize = Math.round(amount * 2 * 0.9 * 100) / 100;
    
    // Уведомление создателю - сохраняем в базе данных
    await notifyDuelResult(
      result.creator_id,
      id,
      `⚔️ Ваш вызов на $${amount} принят! Посмотрите результат.`,
      {
        duel_id: id,
        amount,
        prize,
        result: result.result,
        winner_id: result.winner,
        i_won: result.winner === result.creator_id,
        coin_trajectory: result.coin_trajectory
      }
    );
    
    // Уведомление оппоненту
    await notifyDuelResult(
      user.id,
      id,
      `⚔️ Вы приняли вызов. Результат: ${result.result === 'heads' ? 'орёл' : 'решка'}`,
      {
        duel_id: id,
        amount,
        prize,
        result: result.result,
        winner_id: result.winner,
        i_won: result.winner === user.id,
        coin_trajectory: result.coin_trajectory
      }
    );
    
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
    if (isNaN(id)) throw new Error('Некорректный ID дуэли');
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
    if (isNaN(id)) throw new Error('Некорректный ID дуэли');
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

// GET /api/duel/notifications - получить непрочитанные уведомления о дуэлях
router.get('/notifications', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user || !user.id) {
      return res.json({ notifications: [] });
    }
    const notifications = await getUnreadUserNotifications(user.id);
    res.json({ notifications });
  } catch (e: any) {
    console.error('[NOTIFICATIONS ERROR]', e.message, e.stack);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/duel/notifications/:id/read - отметить уведомление как прочитанное
router.post('/notifications/:id/read', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const notificationId = parseInt(req.params.id);
    if (isNaN(notificationId)) throw new Error('Некорректный ID уведомления');
    const success = await markNotificationAsRead(notificationId, user.id);
    res.json({ success });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/duel/notifications/count - получить количество непрочитанных уведомлений
router.get('/notifications/count', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const count = await getUnreadCount(user.id);
    res.json({ count });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
