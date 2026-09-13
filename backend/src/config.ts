import dotenv from 'dotenv';
dotenv.config();

const demoMode = process.env.DEMO_MODE === 'true';

export const config = {
  port: parseInt(process.env.PORT || '8000'),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://vault:vault_pass@localhost:5432/vault',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  botToken: process.env.BOT_TOKEN || '',
  /** Юзернейм бота для реферальных ссылок. Раньше был захардкожен в
      routes/referral.ts как `vault_game_bot`, поэтому после регистрации
      реального бота все ссылки вели в никуда. */
  botUsername: (process.env.BOT_USERNAME || 'vault_game_bot').replace(/^@/, ''),
  webappUrl: process.env.WEBAPP_URL || 'http://localhost:3000',
  tonApiKey: process.env.TON_API_KEY || '',
  tonMnemonic: process.env.TON_WALLET_MNEMONIC || '',
  usdtAddress: process.env.USDT_JETTON_ADDRESS || '',
  adminPassword: process.env.ADMIN_PASSWORD || (demoMode ? 'admin' : ''),
  securityPepper: process.env.SECURITY_PEPPER || process.env.JWT_SECRET || 'change-me',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || process.env.WEBAPP_URL || 'http://localhost:3000').split(',').map(x => x.trim()).filter(Boolean),
  adminTelegramIds: (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => parseInt(id.trim())).filter(n => Number.isFinite(n) && n > 0),
  demoMode,
  jwtSecret: process.env.JWT_SECRET || 'vault_secret_change_me_in_prod'
};

/** Значения, которые backend отказывается принимать вне демо-режима. */
export const INSECURE_DEMO_DEFAULTS = new Set([
  'vault_secret_change_me_in_prod',
  'local_demo_jwt_secret_change_in_production',
  'change-me',
  'local_demo_security_pepper_change_in_production'
]);

// Multipliers for vault deposit by term
export const VAULT_MULTIPLIERS: Record<number, number> = {
  1: 1.0,
  7: 1.3,
  14: 1.6,
  30: 2.0
};

/**
 * Жёсткий потолок точки взрыва Ракеты.
 *
 * `crash_at` ограничен сверху отношением кассы к ставке (bankroll / bet), а не
 * только формулой 0.9/(1-r), поэтому при кассе больше $10 000 и ставке $1
 * значение выходило за потолок колонки DECIMAL(8,4) = 9999.9999 и INSERT падал
 * с `22003 numeric field overflow`: игрок получал ошибку вместо раунда примерно
 * на каждой 11-тысячной ставке. Колонка расширена до DECIMAL(12,4), а кламп
 * здесь гарантирует, что сервис никогда не сгенерирует значение вне её диапазона.
 */
export const CRASH_HARD_CAP = 1_000_000;

export function roundDownClean(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (value < 10) return Math.max(1, Math.floor(value));
  const digits = Math.floor(value).toString().length;
  const power = Math.pow(10, digits - 1);
  return Math.floor(value / power) * power;
}
