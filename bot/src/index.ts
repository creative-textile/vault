import { Telegraf, Context } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:3000';
/** Юзернейм бота из .env — тот же, который backend подставляет в реферальные ссылки. */
const BOT_USERNAME = (process.env.BOT_USERNAME || '').replace(/^@/, '');
/** Внутренний адрес backend (в docker-compose — http://backend:8000). */
const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

/**
 * Цифры экономики для /help берутся с сервера (GET /api/config), а не
 * захардкожены: комиссию, минимум вывода и минимум пополнения админ меняет в
 * панели, и бот раньше продолжал рассказывать игрокам прежние условия.
 */
interface EconomyInfo {
  min_bet: number;
  withdraw_commission: number;
  commission_percent: number;
  safe_payout_multiplier: number;
}

const ECONOMY_FALLBACK: EconomyInfo = {
  min_bet: 1,
  withdraw_commission: 1,
  commission_percent: 10,
  safe_payout_multiplier: 1.5
};

async function fetchEconomy(): Promise<EconomyInfo> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BACKEND_URL}/api/config`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return ECONOMY_FALLBACK;
    const data: any = await res.json();
    return {
      min_bet: Number(data.min_bet) || ECONOMY_FALLBACK.min_bet,
      withdraw_commission: Number(data.withdraw_commission) ?? ECONOMY_FALLBACK.withdraw_commission,
      commission_percent: Number(data.commission_percent) ?? ECONOMY_FALLBACK.commission_percent,
      safe_payout_multiplier: Number(data.safe_payout_multiplier) || ECONOMY_FALLBACK.safe_payout_multiplier
    };
  } catch {
    return ECONOMY_FALLBACK;
  }
}

// Если токен не задан (демо-режим) — бот не стартует, но не валит весь проект
if (!BOT_TOKEN || BOT_TOKEN === 'demo_token') {
  console.log('[BOT] BOT_TOKEN не установлен — бот не запущен (demo mode).');
  console.log('[BOT] Mini App доступен по ссылке: ' + WEBAPP_URL);
  // Оставляем процесс жить, чтобы контейнер не падал
  setInterval(() => {}, 1000000);
} else {
  const bot = new Telegraf(BOT_TOKEN);

  // Ошибка в обработчике не должна ронять процесс (Telegraf иначе отдаёт её
  // в unhandledRejection, а контейнер перезапускается по кругу)
  bot.catch((err: any, ctx: Context) => {
    console.error(`[BOT] Ошибка в обработке ${ctx?.updateType}:`, err?.message || err);
  });

  bot.start((ctx) => {
    const refCode = (ctx.startPayload as string) || undefined;
    const url = refCode ? `${WEBAPP_URL}?ref=${refCode}` : WEBAPP_URL;

    ctx.reply('🏛️ VAULT — три игры, реальные деньги', {
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 ИГРАТЬ', web_app: { url } }]
        ]
      }
    });
  });

  bot.command('balance', async (ctx) => {
    ctx.reply('💰 Узнать баланс можно в Mini App. Нажмите /start');
  });

  bot.command('help', async (ctx) => {
    const e = await fetchEconomy();
    ctx.reply(
      '🏛️ VAULT — игровая платформа\n\n' +
      '🚀 Ракета — забери до взрыва\n' +
      '⚔️ Дуэль — орёл или решка PvP\n' +
      `🔒 Сейф — взломай замок быстрее других (приз ×${e.safe_payout_multiplier})\n` +
      '💎 Вклад — зарабатывай с оборота\n\n' +
      `Минимальная ставка: $${e.min_bet}\n` +
      `Комиссия игр: ${e.commission_percent}%\n` +
      `Вывод: от $5, комиссия ${e.withdraw_commission}%\n\n` +
      'Пополнение: USDT в сети TON'
    );
  });

  bot.launch()
    .then(async () => {
      console.log('[BOT] Telegram bot started');
      // Проверяем, что токен принадлежит тому боту, чей юзернейм backend
      // подставляет в реферальные ссылки (https://t.me/<BOT_USERNAME>?start=…).
      // При расхождении ссылки ведут в чужой или несуществующий аккаунт, а
      // выглядит это как «рефералы не работают».
      try {
        const me = await bot.telegram.getMe();
        console.log(`[BOT] @${me.username} (id ${me.id})`);
        if (BOT_USERNAME && me.username && BOT_USERNAME.toLowerCase() !== String(me.username).toLowerCase()) {
          console.warn(`[BOT] ВНИМАНИЕ: BOT_USERNAME=${BOT_USERNAME}, но токен принадлежит @${me.username}. ` +
            'Реферальные ссылки будут вести не на этого бота — поправьте .env.');
        }
        if (!BOT_USERNAME) {
          console.warn('[BOT] BOT_USERNAME не задан: backend подставляет vault_game_bot в реферальные ссылки. ' +
            `Укажите BOT_USERNAME=${me.username} в .env.`);
        }
      } catch (e: any) {
        console.warn('[BOT] getMe() не удался (проверьте BOT_TOKEN):', e?.message || e);
      }
    })
    .catch((e: any) => {
      console.error('[BOT] Не удалось запустить бота:', e?.message || e);
      // Процесс остаётся живым: контейнер не должен перезапускаться по кругу
      // из-за временной недоступности api.telegram.org
      setInterval(() => {}, 1000000);
    });

  process.on('SIGINT', () => bot.stop('SIGINT'));
  process.on('SIGTERM', () => bot.stop('SIGTERM'));
  process.on('unhandledRejection', (reason: any) => {
    console.error('[BOT] unhandledRejection:', reason?.message || reason);
  });
}
