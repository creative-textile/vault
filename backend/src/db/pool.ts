import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // Автоматический повтор при обрывах соединения
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20
});

// Без обработчика 'error' любая ошибка свободного соединения пула
// (например, "terminating connection due to unexpected postmaster exit"
// при остановке Postgres) приводит к падению всего процесса.
pool.on('error', (err: any) => {
  console.error(`[DB] Ошибка соединения в пуле (игнорируем, процесс жив): ${err.message}`);
});

export async function waitForDb(maxRetries = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await pool.query('SELECT 1');
      if (res) {
        console.log(`[DB] Connected (attempt ${attempt})`);
        return;
      }
    } catch (e: any) {
      console.log(`[DB] Attempt ${attempt}/${maxRetries} failed: ${e.message}. Retrying in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Could not connect to PostgreSQL after ${maxRetries} attempts`);
}

export async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}
