import { modifyBalance, modifyBalanceWithClient, getUser } from './balance';
import { logPlatformRevenueWithClient } from './revenue';
import { withTransaction } from '../db/pool';
import { config } from '../config';

/**
 * В демо-режиме пополнение — мгновенное, реальный TON не используется.
 * В проде здесь TonClient, прослушка входящих транзакций Jetton USDT.
 */

const DEMO_DEPOSIT_ADDRESS = 'UQBx7dDEMO3f2aVAULTdemoADDRESS';

export async function getOrCreateDepositAddress(userId: number): Promise<string> {
  const user = await getUser(userId);
  if (!user) return DEMO_DEPOSIT_ADDRESS;
  if (user.deposit_address) return user.deposit_address;

  // В демо у всех один адрес; в проде — генерация суб-кошелька или привязка memo
  const addr = DEMO_DEPOSIT_ADDRESS;
  const { query } = await import('../db/pool');
  await query('UPDATE users SET deposit_address = $1 WHERE id = $2', [addr, userId]);
  return addr;
}

export async function setWithdrawAddress(userId: number, address: string) {
  const normalized=String(address||'').trim();
  if(!/^(UQ|EQ)[A-Za-z0-9_-]{46}$/.test(normalized) && !normalized.startsWith('demo')) throw new Error('Некорректный TON-адрес');
  const { query } = await import('../db/pool');
  try { await query('UPDATE users SET withdraw_address=$1 WHERE id=$2',[normalized,userId]); }
  catch(e:any) { if(e?.code==='23505'||/unique/i.test(e?.message||'')) throw new Error('Этот кошелёк уже привязан к другому аккаунту'); throw e; }
}

/**
 * Демо-пополнение (для тестирования без блокчейна).
 *
 * Работает ТОЛЬКО при DEMO_MODE=true. Раньше проверка режима отсутствовала и
 * любой залогиненный пользователь мог начислить себе до $10 000 000 одним
 * запросом — в реальном режиме это прямой выпуск денег из воздуха. Сумма также
 * ограничена сверху: тип транзакции `demo_deposit`, чтобы демо-деньги не
 * смешивались с реальными пополнениями в статистике.
 */
export const DEMO_DEPOSIT_MAX = 10_000;

export async function demoDeposit(userId: number, amount: number) {
  if (!config.demoMode) throw new Error('Демо-пополнение отключено в реальном режиме');
  if (!Number.isFinite(amount) || amount < 2) throw new Error('Минимум $2');
  if (amount > DEMO_DEPOSIT_MAX) throw new Error(`Максимум $${DEMO_DEPOSIT_MAX} за раз`);
  const balance = await modifyBalance(userId, Math.round(amount * 100) / 100, 'demo_deposit', { description: 'Демо-пополнение' });
  return { balance };
}

// Блокировка подбора PIN: Redis основной, память — запасной вариант.
// Без запасного варианта отказ Redis полностью отключал защиту от брутфорса.
const pinFails = new Map<number, { count: number; resetAt: number }>();
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_SEC = 900;

async function pinLocked(userId: number): Promise<number> {
  const key = `pin-fail:${userId}`;
  try {
    const { redis, ensureRedis } = await import('../db/redis');
    await ensureRedis();
    const attempts = Number(await redis.get(key) || 0);
    if (attempts >= PIN_MAX_ATTEMPTS) return Math.max(1, await redis.ttl(key));
    return 0;
  } catch {
    const entry = pinFails.get(userId);
    if (entry && entry.resetAt > Date.now() && entry.count >= PIN_MAX_ATTEMPTS) {
      return Math.ceil((entry.resetAt - Date.now()) / 1000);
    }
    return 0;
  }
}

async function registerPinFailure(userId: number): Promise<void> {
  const key = `pin-fail:${userId}`;
  try {
    const { redis, ensureRedis } = await import('../db/redis');
    await ensureRedis();
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, PIN_LOCK_SEC);
  } catch {
    const now = Date.now();
    const entry = pinFails.get(userId);
    pinFails.set(userId, !entry || entry.resetAt <= now
      ? { count: 1, resetAt: now + PIN_LOCK_SEC * 1000 }
      : { count: entry.count + 1, resetAt: entry.resetAt });
  }
}

async function clearPinFailures(userId: number): Promise<void> {
  pinFails.delete(userId);
  try {
    const { redis, ensureRedis } = await import('../db/redis');
    await ensureRedis();
    await redis.del(`pin-fail:${userId}`);
  } catch { /* Redis недоступен — сбросили только память */ }
}

/**
 * Вывод средств.
 *
 * Что исправлено:
 *  - PIN обязателен ВСЕГДА. Раньше при неустановленном PIN в реальном режиме
 *    достаточно было передать `pin === '0000'` (ветка else пропускала вывод),
 *    то есть вывод без PIN работал у всех, кто его не задал.
 *  - Деньги списываются и заявка на выплату создаются в ОДНОЙ транзакции,
 *    поэтому нельзя получить списание без заявки (или наоборот).
 *  - В реальном режиме больше не возвращается выдуманный `tx_hash`: заявка
 *    получает статус `pending`, а отправляет её оператор в админке
 *    (`POST /api/admin/withdrawals/:id/pay`) — прежний код списывал деньги и
 *    сообщал «выполнено», хотя в блокчейн ничего не уходило.
 */
export async function processWithdrawal(
  userId: number,
  amount: number,
  pin: string,
  withdrawAddress?: string
) {
  const user = await getUser(userId);
  if (!user) throw new Error('Пользователь не найден');

  if (!Number.isFinite(amount) || amount < 5) throw new Error('Минимум $5');
  if (Math.round(amount * 100) > Math.round((user.balance - user.frozen_balance) * 100)) throw new Error('Недостаточно средств');

  const lockedFor = await pinLocked(userId);
  if (lockedFor) throw new Error(`PIN временно заблокирован (${lockedFor} сек.)`);

  if (!user.pin_hash) throw new Error('Сначала установите PIN-код');
  const bcrypt = await import('bcryptjs');
  if (!/^\d{4}$/.test(String(pin || '')) || !(await bcrypt.compare(String(pin), user.pin_hash))) {
    await registerPinFailure(userId);
    throw new Error('Неверный PIN');
  }
  await clearPinFailures(userId);

  const address = withdrawAddress || user.withdraw_address;
  if (!address) throw new Error('Укажите адрес для вывода');

  const feePercent = parseFloat((await (await import('./revenue')).getSetting('withdraw_commission')) || '1');
  const fee = Math.round(amount * (feePercent / 100) * 100) / 100;
  const payout = Math.round((amount - fee) * 100) / 100;
  const status = config.demoMode ? 'paid' : 'pending';
  const txHash = config.demoMode ? 'demo_tx_' + Date.now() : null;

  return withTransaction(async (client) => {
    const balance = await modifyBalanceWithClient(client, userId, -amount, 'withdraw', {
      description: `Вывод ${payout} USDT`
    });
    const ins = await client.query(
      `INSERT INTO withdrawals (user_id, amount, fee, payout, address, status, tx_hash, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'paid' THEN NOW() ELSE NULL END)
       RETURNING id`,
      [userId, amount, fee, payout, address, status, txHash]
    );
    // Комиссия — доход платформы: фиксируется той же транзакцией (и в
    // daily_revenue, и в кассе platform_cashbox), иначе при откате деньги
    // списались бы, а комиссия осталась незаписанной.
    await logPlatformRevenueWithClient(client, fee, 'withdrawal');
    if (status === 'paid') {
      await client.query(
        `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
         VALUES ('platform', 'external', $1, $2)`,
        [payout, `Демо-выплата #${ins.rows[0].id}`]);
    }
    return { withdrawal_id: ins.rows[0].id, status, payout, fee, tx_hash: txHash, balance };
  });
}

/** Заявки на вывод для админки. */
export async function listWithdrawals(status?: 'pending' | 'paid' | 'rejected', limit = 100) {
  const { query } = await import('../db/pool');
  const params: any[] = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE w.status = $${params.length}`; }
  params.push(limit);
  const res = await query(
    `SELECT w.id, w.user_id, w.amount, w.fee, w.payout, w.address, w.status, w.tx_hash,
            w.created_at, w.paid_at, u.telegram_id, u.username
       FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id
       ${where}
      ORDER BY w.status = 'pending' DESC, w.created_at DESC
      LIMIT $${params.length}`, params);
  return res.rows.map(r => ({
    ...r,
    amount: parseFloat(r.amount), fee: parseFloat(r.fee), payout: parseFloat(r.payout)
  }));
}

/**
 * Отметить выплату отправленной (оператор вводит tx_hash из блокчейна).
 * Заявка должна быть в статусе pending — повторная отметка невозможна
 * (UPDATE ... WHERE status='pending' + проверка rowCount), поэтому двойная
 * выплата одной заявки исключена.
 */
export async function payWithdrawal(withdrawalId: number, txHash: string) {
  const normalized = String(txHash || '').trim();
  if (!normalized) throw new Error('Укажите tx_hash');
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE withdrawals SET status = 'paid', tx_hash = $1, paid_at = NOW()
        WHERE id = $2 AND status = 'pending'
        RETURNING payout`, [normalized, withdrawalId]);
    if (!res.rows.length) throw new Error('Заявка не найдена или уже обработана');
    await client.query(
      `INSERT INTO cashbox_transfers (from_source, to_source, amount, note)
       VALUES ('platform', 'external', $1, $2)`,
      [parseFloat(res.rows[0].payout), `Выплата #${withdrawalId} ${normalized}`]);
    return { ok: true };
  });
}

/** Отклонить выплату и вернуть деньги пользователю (одной транзакцией). */
export async function rejectWithdrawal(withdrawalId: number, reason?: string) {
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE withdrawals SET status = 'rejected', reject_reason = $1
        WHERE id = $2 AND status = 'pending'
        RETURNING user_id, amount`, [reason || null, withdrawalId]);
    if (!res.rows.length) throw new Error('Заявка не найдена или уже обработана');
    const { user_id, amount } = res.rows[0];
    await modifyBalanceWithClient(client, user_id, parseFloat(amount), 'withdraw_refund', {
      description: `Возврат по заявке #${withdrawalId}`
    });
    return { ok: true };
  });
}

export async function setPin(userId: number, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN — 4 цифры');
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(pin, 10);
  const { query } = await import('../db/pool');
  await query('UPDATE users SET pin_hash = $1 WHERE id = $2', [hash, userId]);
  await clearPinFailures(userId);
}

export async function verifyPin(userId: number, pin: string): Promise<boolean> {
  const user = await getUser(userId);
  if (!user || !user.pin_hash) return false;
  const bcrypt = await import('bcryptjs');
  return bcrypt.compare(pin, user.pin_hash);
}

/**
 * В проде запускается в фоне, слушает новые транзакции TON.
 */
export async function startDepositListener() {
  if (config.demoMode) {
    console.log('[TON] Demo mode: real TON listener disabled. Use /api/wallet/demo-deposit for testing.');
    return;
  }
  if (!config.tonApiKey || config.tonApiKey === 'demo' || !config.tonMnemonic) {
    console.warn('[TON] TON_API_KEY / TON_WALLET_MNEMONIC не настроены: автоматические пополнения работать не будут. Выплаты обрабатываются вручную в админке.');
  }
  console.log('[TON] Real TON deposit listener started (placeholder — implement with @ton/ton client)');
  // TODO: Реализовать с TonClient 4 / @ton/ton
  // while (true) {
  //   const txs = await tonClient.getTransactions(...);
  //   for (const tx of txs) { ... credit user ... }
  //   await sleep(10000);
  // }
}
