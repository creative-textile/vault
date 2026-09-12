// Время по Москве (UTC+3). Используем сдвиг явно, чтобы не зависеть от TZ хоста.
const MSK_OFFSET_MIN = 3 * 60;

function toMSK(d: Date): Date {
  // Преобразовать в MSK: взять локальное UTC-время, прибавить сдвиг
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utcMs + MSK_OFFSET_MIN * 60000);
}

function fromMSK(msk: Date): Date {
  // Обратная операция: из MSK-компонент сделать настоящий Date
  const utcMs = msk.getTime() - msk.getTimezoneOffset() * 60000;
  return new Date(utcMs - MSK_OFFSET_MIN * 60000);
}

export function nowMSK(): Date {
  return toMSK(new Date());
}

export function todayMSK(): string {
  return nowMSK().toISOString().slice(0, 10);
}

/** Дата следующего дня в МСК (YYYY-MM-DD). */
export function tomorrowMSK(): string {
  const n = nowMSK();
  n.setDate(n.getDate() + 1);
  return n.toISOString().slice(0, 10);
}

/** Возвращает настоящий Date для заданных часов/минут в MSK на сегодня (или завтра, если уже прошло). */
export function nextMSK(hour: number, minute: number): Date {
  const n = nowMSK();
  const target = new Date(n);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= n.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return fromMSK(target);
}

/** Форматировать время (HH:MM) в MSK. */
export function fmtMSK(d: Date): string {
  const m = toMSK(d);
  return String(m.getHours()).padStart(2, '0') + ':' + String(m.getMinutes()).padStart(2, '0');
}
