import cron from 'node-cron';
import { createDailySafe, startCracking, calculateSafeWinners, getTodaySafe } from '../services/safe';
import { dailyVaultDistribution } from '../services/vault-deposit';
import { getSetting } from '../services/revenue';
import { broadcast } from '../services/notifications';
import { nowMSK } from '../utils/time';

export function initCrons() {
  // 09:00 MSK — создать дневной Сейф
  cron.schedule('0 6 * * *', async () => {
    // контейнер может быть в UTC (06:00 UTC = 09:00 MSK)
    console.log('[CRON] Создание дневного сейфа');
    await createDailySafe();
    broadcast('safe_created', {});
  }, { timezone: 'UTC' });

  // Каждую минуту проверяем, не наступило ли время взлома (на основе настроек в МСК)
  let lastCrackDate = '';
  cron.schedule('* * * * *', async () => {
    try {
      const hour = parseInt(await getSetting('safe_crack_hour') || '21');
      const minute = parseInt(await getSetting('safe_crack_minute') || '0');
      const now = nowMSK();
      const today = now.toISOString().slice(0, 10);
      if (now.getHours() === hour && now.getMinutes() === minute && lastCrackDate !== today) {
        lastCrackDate = today;
        console.log(`[CRON] Старт взлома сейфа в ${hour}:${minute} МСК`);
        const res = await startCracking();
        if (!res || res.cancelled) {
          broadcast('safe_cancelled', {});
        } else {
          broadcast('safe_crack_started', { safe: res.safe });
        }

        // Финализация спустя 30 секунд + сразу создаём сейф на следующий день (сбор стартует немедленно)
        setTimeout(async () => {
          const safe = await getTodaySafe();
          if (safe) {
            await calculateSafeWinners(safe.id);
            broadcast('safe_finished', { safe_id: safe.id });
          }
          await createDailySafe();
          broadcast('safe_created', {});
        }, 30000);
      }
    } catch (e: any) {
      console.error('[CRON safe] error:', e.message);
    }
  });

  // 21:00 UTC == 00:00 MSK — распределение Вклада
  cron.schedule('0 21 * * *', async () => {
    console.log('[CRON] Дневное распределение Вклада (полночь МСК)');
    const res = await dailyVaultDistribution();
    broadcast('vault_distributed', res);
    await createDailySafe();
  }, { timezone: 'UTC' });

  // Убедимся, что на сегодня есть сейф (для демо и первого запуска)
  (async () => {
    for (let attempt = 1; attempt <= 15; attempt++) {
      try {
        const safe = await getTodaySafe();
        if (!safe) {
          await createDailySafe();
        }
        return;
      } catch (e) {
        console.log(`[CRON] Waiting for DB to create today safe, attempt ${attempt}...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  })();

  console.log('[CRON] Планировщики запущены (время МСК)');
}
