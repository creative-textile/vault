import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8000'),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://vault:vault_pass@localhost:5432/vault',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  botToken: process.env.BOT_TOKEN || '',
  webappUrl: process.env.WEBAPP_URL || 'http://localhost:3000',
  tonApiKey: process.env.TON_API_KEY || '',
  tonMnemonic: process.env.TON_WALLET_MNEMONIC || '',
  usdtAddress: process.env.USDT_JETTON_ADDRESS || '',
  adminPassword: process.env.ADMIN_PASSWORD || (process.env.DEMO_MODE === 'true' ? 'admin' : ''),
  securityPepper: process.env.SECURITY_PEPPER || process.env.JWT_SECRET || 'change-me',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || process.env.WEBAPP_URL || 'http://localhost:3000').split(',').map(x => x.trim()),
  adminTelegramIds: (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => parseInt(id)).filter(Boolean),
  demoMode: process.env.DEMO_MODE === 'true',
  jwtSecret: process.env.JWT_SECRET || 'vault_secret_change_me_in_prod'
};

// Multipliers for vault deposit by term
export const VAULT_MULTIPLIERS: Record<number, number> = {
  1: 1.0,
  7: 1.3,
  14: 1.6,
  30: 2.0
};

export function roundDownClean(value: number): number {
  if (value < 10) return Math.max(1, Math.floor(value));
  const digits = Math.floor(value).toString().length;
  const power = Math.pow(10, digits - 1);
  return Math.floor(value / power) * power;
}
