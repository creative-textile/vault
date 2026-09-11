import { query } from '../db/pool';

/**
 * Записывает доход платформы для расчёта пула Вклада И пополняет главную кассу.
 */
export async function logPlatformRevenue(amount: number, source: string, date: Date = new Date()) {
  if (amount <= 0) return;
  const dateStr = date.toISOString().slice(0, 10);
  await query(
    `INSERT INTO daily_revenue (date, source, amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (date, source) DO UPDATE SET amount = daily_revenue.amount + $3`,
    [dateStr, source, amount]
  );
  await query('UPDATE platform_cashbox SET amount = amount + $1, updated_at = NOW() WHERE id = 1', [amount]);
}

export async function getPlatformRevenueForDate(date: Date): Promise<number> {
  const dateStr = date.toISOString().slice(0, 10);
  const res = await query('SELECT COALESCE(SUM(amount), 0) as total FROM daily_revenue WHERE date = $1', [dateStr]);
  return parseFloat(res.rows[0].total);
}

export async function getSetting(key: string): Promise<string | null> {
  const res = await query('SELECT value FROM settings WHERE key = $1', [key]);
  return res.rows.length ? res.rows[0].value : null;
}

export async function setSetting(key: string, value: string | number) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, String(value)]
  );
}
