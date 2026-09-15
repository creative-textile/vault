import { Pool, PoolClient, QueryResult } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import { config } from '../config';

type TxContext = { client: PoolClient; afterCommit: Array<() => void> };

const transactionStorage = new AsyncLocalStorage<TxContext>();

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

/**
 * Дождаться готовности Postgres.
 *
 * Лог намеренно «тихий»: первая неудача печатается подробно, дальше — одна
 * строка раз в пять попыток. Прежде каждый промах писал отдельную строку, и
 * за минуту ожидания в `docker logs` набегала простыня «[DB] Attempt N/30
 * failed … Retrying in 2000ms», которая выглядела как авария, хотя это штатное
 * ожидание инициализации БД (см. healthcheck в docker-compose.yml: он
 * проверяет готовность по TCP, поэтому backend стартует уже после init.sql).
 */
export async function waitForDb(maxRetries = 30, delayMs = 2000): Promise<void> {
  const startedAt = Date.now();
  let lastError = '';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await pool.query('SELECT 1');
      if (res) {
        const waitedSec = Math.round((Date.now() - startedAt) / 1000);
        console.log(
          attempt === 1
            ? '[DB] Connected'
            : `[DB] Connected (попытка ${attempt}, ждали ${waitedSec} с)`
        );
        return;
      }
    } catch (e: any) {
      lastError = e.message;
      if (attempt === 1) {
        console.error(`[DB] Attempt ${attempt}/${maxRetries} failed: ${e.message}. Retrying in ${delayMs}ms...`);
      } else if (attempt % 5 === 0) {
        console.error(`[DB] Still waiting for PostgreSQL… (${attempt}/${maxRetries}, ${Math.round((Date.now() - startedAt) / 1000)} s): ${e.message}`);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Could not connect to PostgreSQL after ${maxRetries} attempts: ${lastError}`);
}

export function currentTransactionClient(): PoolClient | undefined { return transactionStorage.getStore()?.client; }

/**
 * Отложить побочный эффект до COMMIT внешней транзакции.
 *
 * Нужно для socket-событий: отправленное до коммита событие описывало бы
 * состояние, которое ещё может откатиться, а отправленное из вложенного
 * `modifyBalance()` не отправлялось вовсе — составные операции (Ракета, Дуэль,
 * Сейф, Вклад) работают через `withTransaction`, поэтому баланс на экране не
 * обновлялся именно в играх. Вне транзакции эффект выполняется сразу.
 */
export function onAfterCommit(effect: () => void): void {
  const ctx = transactionStorage.getStore();
  if (ctx) ctx.afterCommit.push(effect);
  else { try { effect(); } catch { /* побочный эффект не должен ронять операцию */ } }
}

export async function query(text: string, params?: any[]): Promise<QueryResult<any>> {
  return (transactionStorage.getStore()?.client || pool).query(text, params);
}

/** Все query()/modifyBalance()/revenue-вызовы внутри callback используют одно соединение и COMMIT. */
export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const existing = transactionStorage.getStore();
  if (existing) return callback(existing.client);
  const client = await pool.connect();
  const ctx: TxContext = { client, afterCommit: [] };
  let result: T;
  try {
    await client.query('BEGIN');
    result = await transactionStorage.run(ctx, () => callback(client));
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  // Только после успешного COMMIT: откатившаяся операция не должна
  // сообщать клиенту новый баланс.
  for (const effect of ctx.afterCommit) {
    try { effect(); } catch { /* событие не влияет на committed-операцию */ }
  }
  return result;
}


export async function getClient() {
  return pool.connect();
}
