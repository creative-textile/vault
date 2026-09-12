/**
 * Трансляция socket-событий внутри приложения через window-события.
 *
 * App.tsx — единственное место, где живёт socket; остальные экраны подписываются
 * на эти события. Так мы обходимся без window.location.reload(), который обрывал
 * мини-игру взлома сейфа, ронял socket-соединение и сбрасывал состояние экрана.
 */

// ── Сейф ────────────────────────────────────────────────────────────────
export const SAFE_EVENT = 'vault:safe-event';

export type SafeEventType =
  | 'safe_crack_started'
  | 'safe_finished'
  | 'safe_cancelled'
  | 'safe_created';

export interface SafeEventDetail {
  type: SafeEventType;
  data?: any;
}

export function emitSafeEvent(type: SafeEventType, data?: any) {
  window.dispatchEvent(new CustomEvent<SafeEventDetail>(SAFE_EVENT, { detail: { type, data } }));
}

/** Подписаться на события сейфа. Возвращает функцию отписки. */
export function onSafeEvent(handler: (detail: SafeEventDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<SafeEventDetail>).detail);
  window.addEventListener(SAFE_EVENT, listener);
  return () => window.removeEventListener(SAFE_EVENT, listener);
}

// ── Уведомления ─────────────────────────────────────────────────────────
export const NOTIFICATION_EVENT = 'vault:notification';

export interface NotificationEventDetail {
  type?: string;
  title?: string;
  message?: string;
  data?: any;
}

export function emitNotificationEvent(detail: NotificationEventDetail) {
  window.dispatchEvent(
    new CustomEvent<NotificationEventDetail>(NOTIFICATION_EVENT, { detail })
  );
}

/** Подписаться на входящие уведомления (пришли по socket). Возвращает отписку. */
export function onNotificationEvent(
  handler: (detail: NotificationEventDetail) => void
): () => void {
  const listener = (e: Event) =>
    handler((e as CustomEvent<NotificationEventDetail>).detail);
  window.addEventListener(NOTIFICATION_EVENT, listener);
  return () => window.removeEventListener(NOTIFICATION_EVENT, listener);
}
