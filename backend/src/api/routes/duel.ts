import { Router } from 'express';
import { auth } from '../middleware/auth';
import { moneyBody } from '../middleware/security';
import {
  createDuel, getLobby, acceptDuel, cancelDuel, getDuelHistory, getDuel,
  notifyDuelFinished, ensureDuelResultNotifications
} from '../../services/duel';
import { getUnreadUserNotifications } from '../../services/notifications';
import {
  markNotificationAsRead, markAllNotificationsAsRead,
  markDuelNotificationsAsRead, getUnreadCount
} from '../../services/user-notifications';

const router = Router();

// POST /api/duel/create
router.post('/create', auth, moneyBody('amount',0.01), async (req, res) => {
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

// POST /api/duel/accept/:id
router.post('/accept/:id', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new Error('Некорректный ID дуэли');
    const duel = await getDuel(id);
    if (!duel) throw new Error('Дуэль не найдена');

    const result = await acceptDuel(id, user.id);

    // Оба участника получают уведомление: socket (если онлайн) и запись в БД.
    // Создатель комнаты в этот момент может быть где угодно — запись в БД
    // гарантирует, что модальное окно дождётся его даже через несколько дней.
    await notifyDuelFinished(id);

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

// ============================================================
// Уведомления о дуэлях.
// ВАЖНО: эти маршруты обязаны быть зарегистрированы ДО '/:id',
// иначе Express сопоставит '/notifications' с '/:id' и вернёт 400.
// ============================================================

// GET /api/duel/notifications — непрочитанные уведомления пользователя
router.get('/notifications', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user || !user.id) {
      return res.json({ notifications: [] });
    }
    // Сначала досоздаём то, чего не хватает: игрок мог зайти спустя дни после
    // дуэли, и результат обязан его дождаться (модалка с очередью реплеев)
    await ensureDuelResultNotifications(user.id);
    const notifications = await getUnreadUserNotifications(user.id);
    res.json({ notifications });
  } catch (e: any) {
    console.error('[NOTIFICATIONS ERROR]', e.message, e.stack);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/duel/notifications/count — количество непрочитанных уведомлений
router.get('/notifications/count', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const count = await getUnreadCount(user.id);
    res.json({ count });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/duel/notifications/read-all — отметить всё прочитанным (один запрос)
router.post('/notifications/read-all', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    await markAllNotificationsAsRead(user.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/duel/notifications/read-duel/:duelId — пометить уведомления по дуэли
router.post('/notifications/read-duel/:duelId', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const duelId = parseInt(req.params.duelId);
    if (isNaN(duelId)) throw new Error('Некорректный ID дуэли');
    const marked = await markDuelNotificationsAsRead(duelId, user.id);
    res.json({ success: true, marked });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/duel/notifications/:id/read — отметить уведомление прочитанным
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

export default router;
