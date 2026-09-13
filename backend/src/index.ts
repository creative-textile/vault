import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { config } from './config';
import { initCrons, stopCrons } from './cron';
import { initNotifications } from './services/notifications';
import { rateLimit, validatePayload, securityTelemetry } from './api/middleware/security';
import { initNotificationsTable } from './services/user-notifications';
import { startDepositListener } from './services/ton';

import userRoutes from './api/routes/user';
import walletRoutes from './api/routes/wallet';
import rocketRoutes from './api/routes/rocket';
import duelRoutes from './api/routes/duel';
import safeRoutes from './api/routes/safe';
import vaultRoutes from './api/routes/vault-deposit';
import referralRoutes from './api/routes/referral';
import adminRoutes from './api/routes/admin';
import replayRoutes from './api/routes/replay';
import { registerRocketHandlers, startRocketRound } from './websocket/rocket';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin(origin,cb) { if(!origin || config.allowedOrigins.includes(origin)) return cb(null,true); cb(new Error('Origin не разрешён')); }, credentials:true }));
app.use(express.json({limit:'32kb'}));
app.use(validatePayload);
app.use(rateLimit('general',60,60));
app.use(securityTelemetry);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', userRoutes);
app.use('/api/wallet/withdraw', rateLimit('withdrawal',3,3600));
app.use('/api/wallet', walletRoutes);
app.use('/api/rocket/start', rateLimit('rocket_start',10,60));
app.use('/api/rocket', rocketRoutes);
app.use('/api/duel/create', rateLimit('duel_create',5,60));
app.use('/api/duel/accept', rateLimit('duel_accept',5,60));
app.use('/api/duel', duelRoutes);
app.use('/api/safe/deposit', rateLimit('safe_deposit',3,60));
app.use('/api/safe', safeRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/replay', replayRoutes);

// WebSocket: при получении rocket round start, запустить тики
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Redis adapter synchronizes rooms/events when backend is scaled horizontally.
(async()=>{ try { const { createAdapter }=await import('@socket.io/redis-adapter'); const { ensureRedis }=await import('./db/redis'); const pub=await ensureRedis(); const sub=pub.duplicate(); await sub.connect(); io.adapter(createAdapter(pub,sub)); console.log('[REDIS] Socket.io adapter ready'); } catch(e:any) { console.warn('[REDIS] Socket.io adapter fallback:',e.message); } })();

initNotifications(io);

// Auth middleware + room joining for user notifications
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next();
  try {
    // Та же проверка, что и в HTTP-auth: токен должен принадлежать ЭТОМУ
    // пользователю (telegram_id совпал). Иначе сокет с устаревшим токеном
    // попадает в чужую комнату user:<id> и получает чужие уведомления и баланс.
    const { getUserFromToken } = await import('./services/user');
    const user = await getUserFromToken(token);
    if (user) {
      socket.data.userId = user.id;
      socket.join(`user:${user.id}`);
    }
  } catch {}
  next();
});

io.on('connection', (socket) => {
  // Когда клиент запускает ракету — сервер стартует тики по round_id
  socket.on('rocket:launch', (data: { round_id: number, crash_at: number }) => {
    // Доверяем клиенту только round_id; crash_at достаём из БД заново
    import('./db/pool').then(async ({ query }) => {
      const res = await query('SELECT user_id, crash_at FROM rocket_rounds WHERE id = $1', [data.round_id]);
      if (res.rows.length) {
        const userId = res.rows[0].user_id;
        if (userId !== socket.data.userId) return;
        const { ensureRedis, redis }=await import('./db/redis');
        try { await ensureRedis(); const claimed=await redis.set(`rocket-launch:${data.round_id}`,String(userId),'PX',3600000,'NX'); if(claimed!=='OK') return; } catch { /* DB/instance guards remain fallback */ }
        startRocketRound(io, data.round_id, userId, parseFloat(res.rows[0].crash_at));
      }
    });
  });
});

// Регистрируем обработчики rocket после настройки io
registerRocketHandlers(io);

server.listen(config.port, async () => {
  if (!config.demoMode && (config.jwtSecret === 'vault_secret_change_me_in_prod' || config.securityPepper === 'change-me' || !config.adminPassword)) {
    console.error('[SECURITY] JWT_SECRET, SECURITY_PEPPER и ADMIN_PASSWORD обязательны вне demo');
    process.exit(1);
  }
  console.log(`[VAULT] Backend running on port ${config.port}`);
  console.log(`[VAULT] Demo mode: ${config.demoMode}`);

  // Ждём готовности Postgres (до 60 секунд)
  const { waitForDb, query } = await import('./db/pool');
  try {
    await waitForDb(30, 2000);
  } catch (e: any) {
    console.error('[DB] FATAL:', e.message);
    process.exit(1);
  }

  // Миграции для совместимости с уже запущенными БД (idempotent)
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT`);
    await query(`ALTER TABLE rocket_rounds ADD COLUMN IF NOT EXISTS replay_seed VARCHAR(64)`);
    await query(`ALTER TABLE duels ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(id)`);
    await query(`ALTER TABLE duels ADD COLUMN IF NOT EXISTS parent_duel_id INTEGER REFERENCES duels(id)`);
    // Отметка старта фазы взлома сейфа (нужна существующим БД: окно взлома считается от неё)
    try {
      await query(`ALTER TABLE safes ADD COLUMN IF NOT EXISTS crack_started_at TIMESTAMPTZ`);
      await query(`ALTER TABLE safes ADD COLUMN IF NOT EXISTS commission_settled BOOLEAN DEFAULT FALSE`);
      await query(`ALTER TABLE vault_deposits ADD COLUMN IF NOT EXISTS unlocks_at TIMESTAMPTZ`);
      await query(`ALTER TABLE vault_pool_daily ADD COLUMN IF NOT EXISTS distributed_at TIMESTAMPTZ`);
      await query(`UPDATE vault_deposits SET unlocks_at=created_at + (term_days * INTERVAL '1 day') WHERE unlocks_at IS NULL`);
      await query(`CREATE TABLE IF NOT EXISTS vault_deposit_accruals (id SERIAL PRIMARY KEY, deposit_id INTEGER REFERENCES vault_deposits(id), user_id INTEGER REFERENCES users(id), date DATE NOT NULL, pool_amount DECIMAL(12,2) NOT NULL, profit DECIMAL(12,2) NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(deposit_id,date))`);
      // Момент начала сбора: по нему планировщик понимает, не отыгран ли
      // сегодняшний слот взлома предыдущим сейфом (важно при переносе времени в админке)
      await query(`ALTER TABLE safes ADD COLUMN IF NOT EXISTS collect_started_at TIMESTAMPTZ`);
      await query(`UPDATE safes s
                      SET collect_started_at = COALESCE(
                        (SELECT MAX(p.crack_started_at) FROM safes p WHERE p.id < s.id), NOW())
                    WHERE s.collect_started_at IS NULL`);
    } catch (e: any) {
      console.error('[DB] Migration safes.crack_started_at:', e.message);
    }
    await query(`CREATE TABLE IF NOT EXISTS platform_cashbox (
        id SERIAL PRIMARY KEY, amount DECIMAL(14,2) DEFAULT 500, updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await query(`INSERT INTO platform_cashbox (id, amount) VALUES (1, 500) ON CONFLICT (id) DO NOTHING`);
    // Инварианты real-money ledger для уже существующих БД.
    await query(`DO $$ BEGIN ALTER TABLE users ADD CONSTRAINT users_balance_nonnegative CHECK (balance >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await query(`DO $$ BEGIN ALTER TABLE users ADD CONSTRAINT users_frozen_nonnegative CHECK (frozen_balance >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await query(`DO $$ BEGIN ALTER TABLE users ADD CONSTRAINT users_frozen_within_balance CHECK (frozen_balance <= balance); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await query(`DO $$ BEGIN ALTER TABLE rocket_bankroll ADD CONSTRAINT rocket_bankroll_nonnegative CHECK (amount >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await query(`DO $$ BEGIN ALTER TABLE platform_cashbox ADD CONSTRAINT platform_cashbox_nonnegative CHECK (amount >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await query(`DO $$ BEGIN ALTER TABLE safes ADD CONSTRAINT safes_money_nonnegative CHECK (bank >= 0 AND prize_pool >= 0 AND commission_amount >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await query(`CREATE TABLE IF NOT EXISTS cashbox_transfers (
        id SERIAL PRIMARY KEY, from_source VARCHAR(32) NOT NULL, to_source VARCHAR(32) NOT NULL,
        amount DECIMAL(12,2) NOT NULL, note TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS admin_audit_log (id BIGSERIAL PRIMARY KEY,actor_user_id INTEGER REFERENCES users(id),method VARCHAR(12),path TEXT,payload JSONB,status_code INTEGER,ip VARCHAR(128),user_agent TEXT,duration_ms INTEGER,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS user_security_identifiers (id BIGSERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,ip_hash CHAR(64),device_hash CHAR(64),first_seen TIMESTAMPTZ DEFAULT NOW(),last_seen TIMESTAMPTZ DEFAULT NOW(),UNIQUE(user_id,ip_hash,device_hash))`);
    await query(`CREATE TABLE IF NOT EXISTS antifraud_flags (id BIGSERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,kind VARCHAR(64),risk_score INTEGER DEFAULT 0,details JSONB,details_hash CHAR(64),status VARCHAR(16) DEFAULT 'open',created_at TIMESTAMPTZ DEFAULT NOW(),reviewed_at TIMESTAMPTZ,UNIQUE(user_id,kind,details_hash))`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS users_withdraw_address_unique ON users(withdraw_address) WHERE withdraw_address IS NOT NULL AND withdraw_address <> ''`);
    // Убедимся что настройки содержат safe_crack_hour/minute
      const defaults: Record<string,string> = {
      commission_percent:'10', withdraw_commission:'1', referral_percent:'3',
      min_bet:'1', rocket_max_bet_percent:'50', vault_pool_percent:'15',
      safe_min_bank:'25', safe_min_participants:'2', beautiful_flight_chance:'3',
      vault_min_deposit:'10', vault_max_floor:'100', vault_max_multiplier:'10', dead_balance_inactive_days:'180',
      safe_crack_hour:'21', safe_crack_minute:'0',
      safe_crack_timeout_minutes: '1',
      safe_drum_speed_multiplier: '1',
      project_start_date: '2026-01-01'
    };
    // Принудительно обновим min_bank/safe_min_bank на корректные (на случай если в БД остались старые значения $2/$5)
    await query(`UPDATE settings SET value='25' WHERE key='safe_min_bank'`);
    await query(`UPDATE settings SET value='2' WHERE key='safe_min_participants'`);
    // Окно взлома по умолчанию сокращено с 2 минут до 1. Обновляем только те БД,
    // где осталось прежнее значение по умолчанию — осознанный выбор админа не трогаем.
    await query(`UPDATE settings SET value='1' WHERE key='safe_crack_timeout_minutes' AND value='2'`);
    for (const [k,v] of Object.entries(defaults)) {
      await query(`INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [k,v]);
    }
    
    // Инициализируем таблицу уведомлений
    await initNotificationsTable();
    
    // Очищаем уведомления с невалидными duel_id (NaN)
    try {
      await query(`
        DELETE FROM user_notifications 
        WHERE type = 'duel_result' 
          AND (data->>'duel_id' IS NULL 
               OR data->>'duel_id' = 'NaN' 
               OR data->>'duel_id' ~ '^[^0-9]+$')
      `);
      console.log('[DB] Cleaned up notifications with invalid duel_id');
    } catch (e: any) {
      console.error('[DB] Error cleaning notifications:', e.message);
    }

    // ── Одноразовые починки двойной блокировки денег ────────────────────
    // И вызов дуэли, и вклад раньше и ЗАМАРАЖИВАЛИ сумму, и СПИСЫВАЛИ её, а
    // available = balance − frozen_balance, поэтому деньги блокировались
    // дважды. Теперь одно движение денег = одна операция. Починки выполняются
    // ОДИН раз (флаг в settings): вызовы и вклады, созданные уже по новой
    // схеме, не заморожены, и повторный прогон испортил бы баланс.
    try {
      const { getSetting, setSetting } = await import('./services/revenue');

      if ((await getSetting('duel_double_lock_fixed')) !== '1') {
        const { repairDoubleLockedOpenDuels } = await import('./services/duel');
        const n = await repairDoubleLockedOpenDuels();
        await setSetting('duel_double_lock_fixed', '1');
        console.log(`[DB] Дуэли: возвращены на баланс ставки ${n} зависших вызовов, созданных прежним кодом`);
      }

      if ((await getSetting('vault_freeze_fix_applied')) !== '1') {
        const { repairVaultFreeze } = await import('./services/vault-deposit');
        const n = await repairVaultFreeze();
        await setSetting('vault_freeze_fix_applied', '1');
        console.log(`[DB] Вклады: снята лишняя заморозка с ${n} активных вкладов`);
      }

      // Отрицательная заморозка завышала доступный баланс (можно было ставить
      // больше, чем есть). Возникала, например, при гонке двух «Принять» в
      // дуэли. Починка идемпотентна — можно на каждом старте.
      const neg = await query(`UPDATE users SET frozen_balance = 0 WHERE frozen_balance < 0`);
      if (neg.rowCount) console.log(`[DB] Сброшена отрицательная заморозка у ${neg.rowCount} пользователей`);
    } catch (e: any) {
      console.error('[DB] Repair double-locked money:', e.message);
    }

    // Дубли уведомлений о дуэлях (плодились, когда сокет-событие уходило
    // раньше записи в БД): оставляем по одному на пару (игрок, дуэль).
    try {
      const dup = await query(`
        DELETE FROM user_notifications a
         USING user_notifications b
         WHERE a.type = 'duel_result' AND b.type = 'duel_result'
           AND a.user_id = b.user_id
           AND a.data->>'duel_id' IS NOT NULL
           AND a.data->>'duel_id' = b.data->>'duel_id'
           AND a.id > b.id`);
      if (dup.rowCount) console.log(`[DB] Удалено дублей уведомлений о дуэлях: ${dup.rowCount}`);
    } catch (e: any) {
      console.error('[DB] Dedupe duel notifications:', e.message);
    }
  } catch (e: any) {
    console.error('[DB] Migration warning:', e.message);
  }

  initCrons();
  await startDepositListener();
});

// ── Корректное завершение работы ──────────────────────────────────────────
// docker stop / restart / down шлют SIGTERM. Раньше процесс в этот момент
// падал с «terminating connection due to unexpected postmaster exit»:
// Postgres закрывался первым, и необработанная ошибка соединения валила Node.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[VAULT] ${signal}: останавливаюсь...`);

  // Жёсткий выход, если закрытие чего-то зависнет
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();

  try { stopCrons(); } catch { /* планировщики уже остановлены */ }

  await new Promise<void>(resolve => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    try { io.close(() => fin()); } catch { fin(); }
    setTimeout(fin, 3000); // страховка, если колбэк не придёт
  });

  try {
    const { pool } = await import('./db/pool');
    await pool.end();
  } catch (e: any) {
    console.error('[DB] pool.end:', e.message);
  }

  console.log('[VAULT] Остановлен корректно');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// Незакрытое обещание не должно ронять контейнер (например, ошибка сокета в игре)
process.on('unhandledRejection', (reason: any) => {
  console.error('[VAULT] unhandledRejection:', reason?.message || reason);
});
