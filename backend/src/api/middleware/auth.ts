import { Request, Response, NextFunction } from 'express';
import { getUserFromToken } from '../../services/user';
import { config } from '../../config';

export async function auth(req: Request, res: Response, next: NextFunction) {
  // Токен уже разобран в этом же запросе (например, лимитером денежных
  // эндпоинтов, который ставится ДО роута) — повторно читать пользователя
  // из БД не нужно.
  if ((req as any).user) return next();
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

/**
 * Доступ к админ-панели: Telegram ID из allowlist + пароль (`adminPassword`).
 *
 * Две прежние ошибки, из-за которых в проде не было ни одного рабочего
 * сценария доступа:
 *  1. `users.telegram_id` — это BIGINT, а node-pg возвращает BIGINT СТРОКОЙ
 *     (`setTypeParser` в проекте не вызывается). `adminTelegramIds` при этом
 *     массив чисел, поэтому `[123456789].includes("123456789") === false` и
 *     легитимный админ всегда получал 403. Сравниваем числами.
 *  2. `if (config.demoMode) return next()` открывал админку ЛЮБОМУ
 *     залогиненному пользователю, а docker-compose ещё и зашивал
 *     DEMO_MODE="true" литералом. Теперь демо-поблажка действует только
 *     когда allowlist пуст (локальная проверка без настроенного ID); если
 *     оператор задал ADMIN_TELEGRAM_IDS — они проверяются в любом режиме.
 */
export function adminOnly(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(403).json({ error: 'Нет доступа' });
  const allowedIds = config.adminTelegramIds;
  const telegramId = Number(user.telegram_id);
  const isListed = Number.isFinite(telegramId) && allowedIds.includes(telegramId);
  if (!isListed && !(config.demoMode && allowedIds.length === 0)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  next();
}


/**
 * Необязательная авторизация: если токен есть — `req.user` заполняется,
 * если нет или он невалиден — запрос продолжается как анонимный.
 * Нужно эндпоинтам, которые открыты всем, но персонализируют выдачу
 * (например, лобби дуэлей: адресный реванш показывается только адресату).
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  const header = req.headers.authorization;
  if (!header) return next();
  try {
    const user = await getUserFromToken(header.replace('Bearer ', ''));
    if (user && !user.banned) (req as any).user = user;
  } catch { /* анонимный доступ */ }
  next();
}
