import { Request, Response, NextFunction } from 'express';
import { getUserFromToken } from '../../services/user';

export async function auth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет авторизации' });
  const token = header.replace('Bearer ', '');
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Неверный токен' });
  if (user.banned) {
    return res.status(403).json({ error: `Аккаунт заблокирован: ${user.ban_reason || 'обратитесь в поддержку'}` });
  }
  (req as any).user = user;
  next();
}

export function adminOnly(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  const { config } = require('../../config');
  // В демо-режиме доступ к админке есть у всех
  if (config.demoMode) return next();
  if (!user || !config.adminTelegramIds.includes(user.telegram_id)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  next();
}
