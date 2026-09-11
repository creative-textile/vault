import { Router } from 'express';
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
      link: `https://t.me/vault_game_bot?start=${u?.ref_code}`,
      ref_code: u?.ref_code,
      ...stats
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
