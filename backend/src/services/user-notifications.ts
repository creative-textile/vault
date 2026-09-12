/**
 * Сервис для работы с уведомлениями пользователей.
 * Уведомления сохраняются в базе данных и показываются пользователю
 * при следующем входе, если он не находился на страницах /rocket или /safe.
 */
import { query } from '../db/pool';

// Создаём таблицу уведомлений при первом запуске
export async function initNotificationsTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        data JSONB,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE,
        related_entity_type VARCHAR(50),
        related_entity_id INTEGER
      )
    `);
    console.log('[DB] user_notifications table ready');
  } catch (e: any) {
    console.error('[DB] Error creating user_notifications table:', e.message);
  }
}

/**
 * Создать уведомление для пользователя
 */
export async function createNotification(
  userId: number,
  type: string,
  title: string,
  message: string,
  data?: any,
  relatedEntityType?: string,
  relatedEntityId?: number,
  expiresAt?: Date
) {
  const res = await query(
    `INSERT INTO user_notifications 
     (user_id, type, title, message, data, related_entity_type, related_entity_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [userId, type, title, message, data ?? null, relatedEntityType ?? null, relatedEntityId ?? null, expiresAt ?? null]
  );
  return res.rows[0].id;
}

/**
 * Получить непрочитанные уведомления пользователя
 */
export async function getUnreadNotifications(userId: number) {
  const res = await query(
    `SELECT * FROM user_notifications 
     WHERE user_id = $1 AND is_read = FALSE
     ORDER BY created_at DESC`,
    [userId]
  );
  return res.rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    type: r.type,
    title: r.title,
    message: r.message,
    data: r.data,
    is_read: r.is_read,
    created_at: r.created_at,
    expires_at: r.expires_at,
    related_entity_type: r.related_entity_type,
    related_entity_id: r.related_entity_id
  }));
}

/**
 * Получить все уведомления пользователя (включая прочитанные)
 */
export async function getAllNotifications(userId: number, limit = 50) {
  const res = await query(
    `SELECT * FROM user_notifications 
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return res.rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    type: r.type,
    title: r.title,
    message: r.message,
    data: r.data,
    is_read: r.is_read,
    created_at: r.created_at,
    expires_at: r.expires_at,
    related_entity_type: r.related_entity_type,
    related_entity_id: r.related_entity_id
  }));
}

/**
 * Отметить уведомление как прочитанное
 */
export async function markNotificationAsRead(notificationId: number, userId: number) {
  const res = await query(
    `UPDATE user_notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id`,
    [notificationId, userId]
  );
  return res.rows.length > 0;
}

/**
 * Отметить все уведомления пользователя как прочитанные
 */
export async function markAllNotificationsAsRead(userId: number) {
  await query(
    `UPDATE user_notifications SET is_read = TRUE WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Удалить уведомление
 */
export async function deleteNotification(notificationId: number, userId: number) {
  const res = await query(
    `DELETE FROM user_notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
    [notificationId, userId]
  );
  return res.rows.length > 0;
}

/**
 * Удалить прочитанные уведомления старше N дней
 */
export async function cleanupOldNotifications(days: number = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  await query(
    `DELETE FROM user_notifications WHERE is_read = TRUE AND created_at < $1`,
    [cutoff]
  );
}

/**
 * Получить количество непрочитанных уведомлений
 */
export async function getUnreadCount(userId: number) {
  const res = await query(
    `SELECT COUNT(*) FROM user_notifications WHERE user_id = $1 AND is_read = FALSE`,
    [userId]
  );
  return parseInt(res.rows[0].count);
}

/**
 * Проверить, есть ли уведомления о дуэлях для пользователя
 */
export async function hasPendingDuelNotifications(userId: number) {
  const res = await query(
    `SELECT COUNT(*) FROM user_notifications 
     WHERE user_id = $1 AND is_read = FALSE AND type = 'duel_result'`,
    [userId]
  );
  return parseInt(res.rows[0].count) > 0;
}
