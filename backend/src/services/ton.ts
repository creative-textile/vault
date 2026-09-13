import { modifyBalance, getUser } from './balance';
import { logPlatformRevenue } from './revenue';
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
 * В проде функция listen_deposits() подключается к TON API.
 */
export async function demoDeposit(userId: number, amount: number) {
  if (amount < 2) throw new Error('Минимум $2');
  const balance = await modifyBalance(userId, amount, 'deposit', { description: 'Демо-пополнение' });
  return { balance };
}

/**
 * Вывод средств.
 * В демо — мгновенный фейк, без реальной отправки TON.
 */
export async function processWithdrawal(
  userId: number,
  amount: number,
  pin: string,
  withdrawAddress?: string
) {
  const user = await getUser(userId);
  if (!user) throw new Error('Пользователь не найден');

  if (amount < 5) throw new Error('Минимум $5');
  if (Math.round(amount * 100) > Math.round((user.balance - user.frozen_balance) * 100)) throw new Error('Недостаточно средств');

  // PIN: пять ошибок блокируют попытки на 15 минут (Redis, с безопасным fallback rate limit на маршруте).
  const { redis, ensureRedis } = await import('../db/redis');
  const pinKey=`pin-fail:${userId}`;
  try { await ensureRedis(); const ttl=await redis.ttl(pinKey); const attempts=Number(await redis.get(pinKey)||0); if(attempts>=5) throw new Error(`PIN временно заблокирован (${Math.max(ttl,1)} сек.)`); } catch(e:any) { if(/заблокирован/.test(e.message)) throw e; }
  const bcrypt = await import('bcryptjs');
  if (user.pin_hash) {
    const ok = await bcrypt.compare(pin, user.pin_hash);
    if (!ok) { try { await ensureRedis(); const n=await redis.incr(pinKey); if(n===1) await redis.expire(pinKey,900); } catch {} throw new Error('Неверный PIN'); }
  } else if (pin !== '0000') {
    // Если PIN не установлен в демо — пропускаем с 0000
    if (!config.demoMode) throw new Error('Установите PIN перед выводом');
  }

  try { await ensureRedis(); await redis.del(pinKey); } catch {}

  const feePercent = parseFloat((await (await import('./revenue')).getSetting('withdraw_commission')) || '1');
  const fee = Math.round(amount * (feePercent / 100) * 100) / 100;
  const payout = Math.round((amount - fee) * 100) / 100;

  const balance = await modifyBalance(userId, -amount, 'withdraw', {
    description: `Вывод ${payout} USDT`
  });
  await logPlatformRevenue(fee, 'withdrawal');

  // В проде — отправка через @ton/ton:
  // const txHash = await tonClient.sendUsdt(user.withdraw_address, payout);
  const txHash = 'demo_tx_' + Date.now();

  return { payout, tx_hash: txHash, balance };
}

export async function setPin(userId: number, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN — 4 цифры');
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(pin, 10);
  const { query } = await import('../db/pool');
  await query('UPDATE users SET pin_hash = $1 WHERE id = $2', [hash, userId]);
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
  console.log('[TON] Real TON deposit listener started (placeholder — implement with @ton/ton client)');
  // TODO: Реализовать с TonClient 4 / @ton/ton
  // while (true) {
  //   const txs = await tonClient.getTransactions(...);
  //   for (const tx of txs) { ... credit user ... }
  //   await sleep(10000);
  // }
}
