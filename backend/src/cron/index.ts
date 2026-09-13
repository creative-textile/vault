import cron from 'node-cron';
import {
  createDailySafe, startCracking, getTodaySafe, ensureNextDaySafe,
  finalizeCrackIfDue, resumeCracking, getCollectingSafeOrNull, getCollectStartedAt
} from '../services/safe';
import { dailyVaultDistribution, completeMatureVaultDeposits } from '../services/vault-deposit';
import { getSetting } from '../services/revenue';
import { broadcast } from '../services/notifications';
import { nowMSK, todayMSK, todaySlotMSK } from '../utils/time';
import { getFinancialReconciliation } from '../services/financial-audit';

/**
 * Старт взлома в настроенное время МСК.
 *
 * Ломаем сейф, который сейчас СОБИРАЕТ (обычно сегодняшний, а после розыгрыша —
 * сейф следующего дня). Слотом взлома считается настроенное время сегодняшнего
 * дня; если админ перенёс время в настройках, собирающий сейф откроется в новый
 * слот — ждать сутки не нужно.
 *
 * Защита от повторного старта в том же слоте: если сейф начал собирать позже
 * текущего слота, значит этот слот уже отыгран предыдущим сейфом (он только что
 * был взломан), и следующий взлом — завтра.
 */
async function maybeStartCrack(lastCrackDate: string): Promise<string> {
  const hour = parseInt(await getSetting('safe_crack_hour') || '21');
  const minute = parseInt(await getSetting('safe_crack_minute') || '0');
  const now = nowMSK();
  const today = todayMSK();

  const safe = await getCollectingSafeOrNull();
  if (!safe) {
    // Собирать некому: создаём сегодняшний сейф (и следующий, если сегодня уже разыгран)
    if (!(await getTodaySafe())) await createDailySafe();
    await ensureNextDaySafe();
    const created = await getCollectingSafeOrNull();
    return created ? lastCrackDate : today;
  }

  const slot = todaySlotMSK(hour, minute);
  if (now.getTime() < slot.getTime()) return lastCrackDate; // слот ещё не наступил

  // Слот уже наступил. Проверяем, не отыгран ли он предыдущим сейфом
  const collectStarted = await getCollectStartedAt(safe.id);
  if (collectStarted && collectStarted.getTime() >= slot.getTime()) {
    // Сейф начал собирать после текущего слота → ждём следующий (завтра)
    return today;
  }

  lastCrackDate = today;
  console.log(`[CRON] Старт взлома сейфа #${safe.id} в ${hour}:${String(minute).padStart(2, '0')} МСК (текущее время: ${now.getHours()}:${now.getMinutes()})`);
  const res = await startCracking();
  if (!res || res.cancelled) {
    console.log('[CRON] Сейф отменён (не набрал минимум)');
    broadcast('safe_cancelled', {});
  } else if (res.started) {
    console.log(`[CRON] Сейф переведён в фазу взлома, окно ${Math.round((res.window_ms || 0) / 1000)} с`);
    broadcast('safe_crack_started', { safe: res.safe, window_ms: res.window_ms });
  }
  return lastCrackDate;
}

/**
 * Один тик планировщика сейфа: страховка по финализации + проверка старта взлома.
 * Экспортирован, чтобы тесты (и отладка) могли вызвать тик детерминированно,
 * не дожидаясь границы минуты.
 */
export async function runSafeTick(lastCrackDate = ''): Promise<string> {
  const finalized = await finalizeCrackIfDue();
  if (finalized) console.log(`[CRON] Окно взлома сейфа #${finalized} истекло — итоги подведены`);
  return maybeStartCrack(lastCrackDate);
}

/** Запущенные задачи — нужны для корректного завершения процесса. */
const tasks: cron.ScheduledTask[] = [];

/** Остановить все планировщики (вызывается при SIGTERM/SIGINT). */
export function stopCrons(): void {
  for (const t of tasks) { try { t.stop(); } catch { /* уже остановлена */ } }
  tasks.length = 0;
}

export function initCrons() {
  // 09:00 MSK — создать дневной Сейф
  tasks.push(cron.schedule('0 6 * * *', async () => {
    // контейнер может быть в UTC (06:00 UTC = 09:00 MSK)
    console.log('[CRON] Создание дневного сейфа');
    await createDailySafe();
    broadcast('safe_created', {});
  }, { timezone: 'UTC' }));

  // Каждую минуту: страховка по завершению взлома + проверка времени старта (МСК)
  let lastCrackDate = '';
  tasks.push(cron.schedule('* * * * *', async () => {
    try {
      lastCrackDate = await runSafeTick(lastCrackDate);
    } catch (e: any) {
      console.error('[CRON safe] error:', e.message);
    }
  }));

  // Финансовая самопроверка: нарушение инварианта попадает в production logs/alerts.
  tasks.push(cron.schedule('7 * * * *', async () => {
    try {
      const audit=await getFinancialReconciliation();
      if (!audit.ok) console.error('[FINANCIAL RECONCILIATION FAILED]', JSON.stringify(audit));
    } catch(e:any) { console.error('[FINANCIAL RECONCILIATION ERROR]', e.message); }
  }));

  // Полные сроки вкладов завершаются независимо от полуночного начисления.
  tasks.push(cron.schedule('* * * * *', async () => {
    try { await completeMatureVaultDeposits(); } catch (e: any) { console.error('[CRON vault maturity]', e.message); }
  }));

  // 21:00 UTC == 00:00 MSK — распределение Вклада
  tasks.push(cron.schedule('0 21 * * *', async () => {
    console.log('[CRON] Дневное распределение Вклада (полночь МСК)');
    const res = await dailyVaultDistribution();
    broadcast('vault_distributed', res);
    await createDailySafe();
  }, { timezone: 'UTC' }));

  // Убедимся, что на сегодня есть сейф (для демо и первого запуска),
  // и восстановим таймеры взлома, потерянные при рестарте процесса
  (async () => {
    for (let attempt = 1; attempt <= 15; attempt++) {
      try {
        const safe = await getTodaySafe();
        if (!safe) await createDailySafe();
        await resumeCracking();
        lastCrackDate = await maybeStartCrack(lastCrackDate);
        return;
      } catch (e) {
        console.log(`[CRON] Waiting for DB to create today safe, attempt ${attempt}...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  })();

  console.log('[CRON] Планировщики запущены (время МСК)');
  console.log('[CRON] Проверка времени взлома каждую минуту...');
}
