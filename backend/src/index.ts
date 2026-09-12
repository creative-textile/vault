import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { config } from './config';
import { initCrons } from './cron';
import { initNotifications } from './services/notifications';
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
import { registerRocketHandlers, startRocketRound } from './websocket/rocket';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/rocket', rocketRoutes);
app.use('/api/duel', duelRoutes);
app.use('/api/safe', safeRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/admin', adminRoutes);

// WebSocket: при получении rocket round start, запустить тики
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

initNotifications(io);

// Auth middleware + room joining for user notifications
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next();
  try {
    const jwt = await import('jsonwebtoken');
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    socket.data.userId = decoded.userId;
    socket.join(`user:${decoded.userId}`);
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
        startRocketRound(io, data.round_id, userId, parseFloat(res.rows[0].crash_at));
      }
    });
  });
});

// Регистрируем обработчики rocket после настройки io
registerRocketHandlers(io);

server.listen(config.port, async () => {
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
    // Отметка старта фазы взлома сейфа (нужна существующим БД: окно взлома считается от неё)
    try {
      await query(`ALTER TABLE safes ADD COLUMN IF NOT EXISTS crack_started_at TIMESTAMPTZ`);
    } catch (e: any) {
      console.error('[DB] Migration safes.crack_started_at:', e.message);
    }
    await query(`CREATE TABLE IF NOT EXISTS platform_cashbox (
        id SERIAL PRIMARY KEY, amount DECIMAL(14,2) DEFAULT 500, updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await query(`INSERT INTO platform_cashbox (id, amount) VALUES (1, 500) ON CONFLICT (id) DO NOTHING`);
    await query(`CREATE TABLE IF NOT EXISTS cashbox_transfers (
        id SERIAL PRIMARY KEY, from_source VARCHAR(32) NOT NULL, to_source VARCHAR(32) NOT NULL,
        amount DECIMAL(12,2) NOT NULL, note TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);
    // Убедимся что настройки содержат safe_crack_hour/minute
      const defaults: Record<string,string> = {
      commission_percent:'10', withdraw_commission:'1', referral_percent:'3',
      min_bet:'1', rocket_max_bet_percent:'50', vault_pool_percent:'15',
      safe_min_bank:'25', safe_min_participants:'2', beautiful_flight_chance:'3',
      vault_min_deposit:'10', vault_max_deposit:'100',
      safe_crack_hour:'21', safe_crack_minute:'0',
      safe_crack_timeout_minutes: '2'
    };
    // Принудительно обновим min_bank/safe_min_bank на корректные (на случай если в БД остались старые значения $2/$5)
    await query(`UPDATE settings SET value='25' WHERE key='safe_min_bank'`);
    await query(`UPDATE settings SET value='2' WHERE key='safe_min_participants'`);
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
  } catch (e: any) {
    console.error('[DB] Migration warning:', e.message);
  }

  initCrons();
  await startDepositListener();
});
