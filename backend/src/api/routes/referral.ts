import { Router } from 'express';
import { config } from '../../config';
import { auth } from '../middleware/auth';
import { getReferralStats } from '../../services/referral';
import { getUser } from '../../services/balance';

const router = Router();

// GET /api/referral/stats
router.get('/stats', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const u = await getUser(user.id);
    const stats = await getReferralStats(user.id);
    res.json({
      // Юзернейм бота берётся из BOT_USERNAME: раньше здесь был захардкожен
      // vault_game_bot, и после регистрации настоящего бота реферальные ссылки
      // вели в чужой (или несуществующий) аккаунт.
      link: `https://t.me/${config.botUsername}?start=${u?.ref_code}`,
      ref_code: u?.ref_code,
      ...stats
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
