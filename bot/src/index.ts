import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:3000';

// Если токен не задан (демо-режим) — бот не стартует, но не валит весь проект
if (!BOT_TOKEN || BOT_TOKEN === 'demo_token') {
  console.log('[BOT] BOT_TOKEN не установлен — бот не запущен (demo mode).');
  console.log('[BOT] Mini App доступен по ссылке: ' + WEBAPP_URL);
  // Оставляем процесс жить, чтобы контейнер не падал
  setInterval(() => {}, 1000000);
} else {
  const bot = new Telegraf(BOT_TOKEN);

  bot.start((ctx) => {
    const refCode = (ctx.startPayload as string) || undefined;
    const url = refCode ? `${WEBAPP_URL}?ref=${refCode}` : WEBAPP_URL;

    ctx.reply('🏛️ VAULT — три игры, реальные деньги', {
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 ИГРАТЬ', web_app: { url } }
        ]]
      }
    });
  });

  bot.command('balance', async (ctx) => {
    ctx.reply('💰 Узнать баланс можно в Mini App. Нажмите /start');
  });

  bot.command('help', (ctx) => {
    ctx.reply(
      '🏛️ VAULT — игровая платформа\n\n' +
      '🚀 Ракета — забери до взрыва\n' +
      '⚔️ Дуэль — орёл или решка PvP\n' +
      '🔒 Сейф — взломай замок быстрее других\n' +
      '💎 Вклад — зарабатывай с оборота\n\n' +
      'Минимум пополнения: $2 USDT (сеть TON)\n' +
      'Комиссия игр: 10%\n' +
      'Вывод: от $5, комиссия 1%'
    );
  });

  bot.launch();
  console.log('[BOT] Telegram bot started');

  process.on('SIGINT', () => bot.stop('SIGINT'));
  process.on('SIGTERM', () => bot.stop('SIGTERM'));
}
