import { query } from '../db/pool';
import type { PoolClient } from 'pg';
import { nowMSK } from '../utils/time';

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

/** Записать доход и физически пополнить кассу в той же SQL-транзакции. */
export async function logPlatformRevenueWithClient(client: PoolClient, amount: number, source: string, date: Date = nowMSK()) {
  const cents = Math.round(amount * 100);
  if (cents <= 0) return;
  const value = cents / 100;
  await client.query(
    `INSERT INTO daily_revenue (date, source, amount) VALUES ($1,$2,$3)
     ON CONFLICT (date, source) DO UPDATE SET amount = daily_revenue.amount + $3`,
    [dateKey(date), source, value]
  );
  const cash = await client.query(
    `UPDATE platform_cashbox SET amount = amount + $1, updated_at = NOW() WHERE id = 1 RETURNING amount`, [value]
  );
  if (!cash.rows.length) throw new Error('Касса платформы не инициализирована');
}

export async function logPlatformRevenue(amount: number, source: string, date: Date = nowMSK()) {
  const { pool, currentTransactionClient } = await import('../db/pool');
  const outer=currentTransactionClient();
  if (outer) return logPlatformRevenueWithClient(outer, amount, source, date);
  const client = await pool.connect();
  try { await client.query('BEGIN'); await logPlatformRevenueWithClient(client, amount, source, date); await client.query('COMMIT'); }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function getPlatformRevenueForDate(date: Date): Promise<number> {
  const res = await query('SELECT COALESCE(SUM(amount),0) AS total FROM daily_revenue WHERE date=$1', [dateKey(date)]);
  return parseFloat(res.rows[0].total);
}
export async function getSetting(key: string): Promise<string | null> {
  const res = await query('SELECT value FROM settings WHERE key=$1', [key]);
  return res.rows.length ? res.rows[0].value : null;
}
export async function setSetting(key: string, value: string | number) {
  await query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [key,String(value)]);
}
