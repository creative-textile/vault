import cron from 'node-cron';
import { createDailySafe, startCracking, calculateSafeWinners, getTodaySafe } from '../services/safe';
import { dailyVaultDistribution } from '../services/vault-deposit';
import { getSetting } from '../services/revenue';
import { broadcast } from '../services/notifications';
import { nowMSK } from '../utils/time';
import { query } from '../db/pool';

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
      
      // Проверяем, наступило ли время взлома
      const isCrackTime = now.getHours() === hour && now.getMinutes() === minute;
      
      // Также проверяем, если время взлома уже прошло сегодня (для случая, когда админ изменил время на прошедшее)
      // Создаём дату для сравнения в том же часовом поясе
      const crackTimeToday = new Date(now);
      crackTimeToday.setHours(hour, minute, 0, 0);
      
      // Сравниваем timestamp
      const nowTs = now.getTime();
      const crackTs = crackTimeToday.getTime();
      const isPastCrackTime = nowTs > crackTs && lastCrackDate !== today;
      
      if ((isCrackTime || isPastCrackTime) && lastCrackDate !== today) {
        lastCrackDate = today;
        console.log(`[CRON] Старт взлома сейфа в ${hour}:${minute} МСК (текущее время: ${now.getHours()}:${now.getMinutes()})`);
        const res = await startCracking();
        if (!res || res.cancelled) {
          console.log('[CRON] Сейф отменён (не набрал минимум)');
          broadcast('safe_cancelled', {});
        } else {
          console.log('[CRON] Сейф переведён в фазу взлома');
          broadcast('safe_crack_started', { safe: res.safe });
        }

        // Финализация через 1 секунду
        setTimeout(async () => {
          const safe = await getTodaySafe();
          if (safe) {
            await calculateSafeWinners(safe.id);
            broadcast('safe_finished', { safe_id: safe.id });
          }
          // Создаём новый сейф на следующий день - сбор начинается сразу
          // Но не создаём, если он уже создан в startCracking
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toISOString().slice(0, 10);
          const nextSafeExists = await query('SELECT id FROM safes WHERE date = $1', [tomorrowStr]);
          if (!nextSafeExists.rows.length) {
            await createDailySafe();
            broadcast('safe_created', {});
          }
        }, 1000); // 1 секунда для завершения взлома
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
        } else {
          // Проверяем, не нужно ли запустить взлом сразу (если время уже наступило)
          const hour = parseInt(await getSetting('safe_crack_hour') || '21');
          const minute = parseInt(await getSetting('safe_crack_minute') || '0');
          const now = nowMSK();
          const today = now.toISOString().slice(0, 10);
          
          const crackTimeToday = new Date(now);
          crackTimeToday.setHours(hour, minute, 0, 0);
          
          // Сравниваем timestamp
          const nowTs = now.getTime();
          const crackTs = crackTimeToday.getTime();
          
          // Если время взлома уже наступило сегодня и сейф ещё в фазе сбора
          if (nowTs > crackTs && safe.status === 'collecting') {
            console.log(`[CRON INIT] Время взлома ${hour}:${minute} уже наступило, запускаем взлом сразу`);
            const res = await startCracking();
            if (!res || res.cancelled) {
              console.log('[CRON INIT] Сейф отменён (не набрал минимум)');
              broadcast('safe_cancelled', {});
            } else {
              console.log('[CRON INIT] Сейф переведён в фазу взлома');
              broadcast('safe_crack_started', { safe: res.safe });
              
              // Финализация через 1 секунду
              setTimeout(async () => {
                const safeAfter = await getTodaySafe();
                if (safeAfter) {
                  await calculateSafeWinners(safeAfter.id);
                  broadcast('safe_finished', { safe_id: safeAfter.id });
                }
                // Создаём новый сейф на следующий день
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const tomorrowStr = tomorrow.toISOString().slice(0, 10);
                const nextSafeExists = await query('SELECT id FROM safes WHERE date = $1', [tomorrowStr]);
                if (!nextSafeExists.rows.length) {
                  await createDailySafe();
                  broadcast('safe_created', {});
                }
              }, 1000);
            }
          }
        }
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
