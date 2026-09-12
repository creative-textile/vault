import cron from 'node-cron';
import {
  createDailySafe, startCracking, getTodaySafe, ensureNextDaySafe,
  finalizeCrackIfDue, resumeCracking
} from '../services/safe';
import { dailyVaultDistribution } from '../services/vault-deposit';
import { getSetting } from '../services/revenue';
import { broadcast } from '../services/notifications';
import { nowMSK, todayMSK } from '../utils/time';

/**
 * Старт взлома в настроенное время МСК (или «догоняюще», если время уже прошло,
 * а сейф ещё в фазе сбора — например, после простоя контейнера).
 * Финализация не делается здесь: её ставит startCracking() по окончании окна
 * взлома, плюс каждую минуту работает страховка finalizeCrackIfDue().
 */
async function maybeStartCrack(lastCrackDate: string): Promise<string> {
  const hour = parseInt(await getSetting('safe_crack_hour') || '21');
  const minute = parseInt(await getSetting('safe_crack_minute') || '0');
  const now = nowMSK();
  const today = todayMSK();

  const safe = await getTodaySafe();
  if (!safe) {
    await createDailySafe();
    return lastCrackDate;
  }

  if (safe.status !== 'collecting') {
    // Взлом уже идёт или сейф разыгран/отменён — сегодня больше не стартуем
    if (safe.status === 'finished' || safe.status === 'cancelled') await ensureNextDaySafe();
    return today;
  }

  const crackTimeToday = new Date(now);
  crackTimeToday.setHours(hour, minute, 0, 0);
  if (now.getTime() < crackTimeToday.getTime()) return lastCrackDate; // ещё рано

  lastCrackDate = today;
  console.log(`[CRON] Старт взлома сейфа в ${hour}:${String(minute).padStart(2, '0')} МСК (текущее время: ${now.getHours()}:${now.getMinutes()})`);
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
      const finalized = await finalizeCrackIfDue();
      if (finalized) console.log(`[CRON] Окно взлома сейфа #${finalized} истекло — итоги подведены`);
      lastCrackDate = await maybeStartCrack(lastCrackDate);
    } catch (e: any) {
      console.error('[CRON safe] error:', e.message);
    }
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
