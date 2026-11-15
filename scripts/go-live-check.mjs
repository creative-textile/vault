#!/usr/bin/env node
/**
 * Оракул фазы Ф2 «go-live:check» (docs/PHASES.md) — раньше ссылка на этот
 * скрипт была мёртвой: package.json его вызывал, файла не было. Проверки
 * намеренно зашиты здесь, а не читаются из манифеста.
 *
 * Проверяет готовность локального .env к боевому режиму. Ничего не отправляет,
 * секреты не печатает (только имена переменных и «заполнено/нет»).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDERS = /^(|your_.*|change_me.*|replace_with.*|demo_token|.*_here|twenty four word.*)$/i;

function readEnv() {
  const out = {};
  const p = resolve(ROOT, '.env');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const keys = ['DEMO_MODE', 'JWT_SECRET', 'SECURITY_PEPPER', 'BOT_TOKEN', 'ADMIN_PASSWORD',
    'ADMIN_TELEGRAM_IDS', 'ALLOWED_ORIGINS', 'BOT_USERNAME', 'WEBAPP_URL',
    'TON_API_KEY', 'TON_WALLET_MNEMONIC', 'USDT_JETTON_ADDRESS'];
  for (const k of keys) if (process.env[k] !== undefined) out[k] = process.env[k];
  return out;
}

const env = readEnv();
const problems = [];
const notes = [];
const val = (k) => String(env[k] ?? '').trim();
const filled = (k) => val(k) && !PLACEHOLDERS.test(val(k)) && !/^(true|false)$/i.test(val(k));

if (val('DEMO_MODE') !== 'false') problems.push('DEMO_MODE должен быть false (сейчас не боевой режим)');
for (const k of ['JWT_SECRET', 'SECURITY_PEPPER', 'BOT_TOKEN', 'ADMIN_PASSWORD', 'ADMIN_TELEGRAM_IDS', 'ALLOWED_ORIGINS', 'BOT_USERNAME', 'WEBAPP_URL']) {
  if (!filled(k)) problems.push(`${k}: не заполнено или осталось демонстрационным значением`);
}
if (filled('JWT_SECRET') && val('JWT_SECRET').length < 32) problems.push('JWT_SECRET короче 32 символов');
if (filled('ALLOWED_ORIGINS') && val('ALLOWED_ORIGINS').includes('*')) problems.push('ALLOWED_ORIGINS не должен содержать *');
if (!/^https:\/\//.test(val('WEBAPP_URL'))) problems.push('WEBAPP_URL должен быть HTTPS-адресом');

for (const k of ['TON_API_KEY', 'TON_WALLET_MNEMONIC', 'USDT_JETTON_ADDRESS']) {
  if (!filled(k)) notes.push(`${k}: не заполнено (допустимо до testnet; обязательно до mainnet)`);
}
for (const f of ['.env.example', 'backend/src/db/init.sql', 'backend/src/db/schema-check.sql', 'docker-compose.yml']) {
  if (!existsSync(resolve(ROOT, f))) problems.push(`нет файла ${f}`);
}

if (problems.length) {
  console.error('[go-live] НЕ ГОТОВО:');
  for (const p of problems) console.error('  ✗ ' + p);
  for (const n of notes) console.error('  · ' + n);
  process.exitCode = 1;
} else {
  console.log('[go-live] конфигурация боевого контура заполнена');
  for (const n of notes) console.log('  · ' + n);
  console.log('[go-live] перед включением mainnet: npm run preflight:full, прогон testnet, подпись Security & Payments Auditor');
  process.exitCode = 0;
}
