// Форматирование времени по Москве (UTC+3). Сервер/Postgres в докере работает в UTC,
// поэтому при выводе пользователю добавляем 3 часа явно.

export function toMSK(d: Date): Date {
  return new Date(d.getTime() + 3 * 3600 * 1000);
}

export function fmtDateTimeMSK(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const m = new Date(d.getTime() + 3 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(m.getUTCDate())}.${pad(m.getUTCMonth()+1)}.${m.getUTCFullYear()} ${pad(m.getUTCHours())}:${pad(m.getUTCMinutes())}`;
}

export function fmtDateMSK(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const m = new Date(d.getTime() + 3 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(m.getUTCDate())}.${pad(m.getUTCMonth()+1)}.${m.getUTCFullYear()}`;
}
