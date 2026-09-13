/**
 * Смоук-тесты Сейфа: даты, бесконечная цепочка раундов, правила приёма
 * результата взлома и HTTP-маршруты.
 *
 * Живой PostgreSQL не нужен — всё считается в pg-mem, поэтому тесты можно
 * гонять где угодно:
 *
 *   node tests/smoke.cjs           # все режимы подряд (каждый в своём процессе)
 *   node tests/smoke.cjs dates     # арифметика дат (в т.ч. часовые пояса)
 *   node tests/smoke.cjs chain     # цепочка сейфов не обрывается
 *   node tests/smoke.cjs crack     # приём результата взлома
 *   node tests/smoke.cjs http      # /api/safe/current, /api/stats/summary, настройки, токены
 *   node tests/smoke.cjs duel      # деньги вызова, уведомления о результате, очередь реплеев
 *   node tests/smoke.cjs vault     # вклад: списание без заморозки, возврат, выплата в срок
 *   node tests/smoke.cjs money     # гонки денежных операций (ракета, сейф): двойная выплата/списание
 *
 * Особенности pg-mem, которые здесь учтены: DECIMAL без точности, DATE приходит
 * строкой (в живой БД — Date в локальной полночи, поэтому даты проверяем
 * отдельно), нет вычитания timestamptz — вся арифметика окон на стороне JS.
 */
const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

// Зависимости берём из backend/node_modules независимо от cwd
process.env.NODE_PATH = path.join(BACKEND, 'node_modules') + path.delimiter + (process.env.NODE_PATH || '');
require('module').Module._initPaths();

const MODES = ['dates', 'chain', 'crack', 'http', 'duel', 'vault', 'money'];
const ARG = process.argv[2];

// ── Режим «всё подряд»: каждый режим в отдельном процессе (своя БД) ───────
if (!ARG || ARG === 'all') {
  const { execFileSync } = require('child_process');
  let failed = 0;
  for (const mode of MODES) {
    try {
      execFileSync(process.execPath, [__filename, mode], { stdio: 'inherit' });
    } catch (e) {
      failed++;
    }
  }
  console.log(failed === 0
    ? '\n🎉 ВСЕ СМОУК-ТЕСТЫ ПРОЙДЕНЫ\n'
    : `\n💥 ПРОВАЛЕНО РЕЖИМОВ: ${failed} из ${MODES.length}\n`);
  process.exit(failed === 0 ? 0 : 1);
}
if (!MODES.includes(ARG)) {
  console.error(`Неизвестный режим: ${ARG}. Доступны: ${MODES.join(', ')}`);
  process.exit(2);
}
const MODE = ARG;

process.env.DATABASE_URL = 'postgresql://vault:vault_pass@localhost:5432/vault';
process.env.DEMO_MODE = 'true';
process.env.TZ = 'Europe/Moscow';

const Module = require('module');
const { newDb } = require('pg-mem');
const mem = newDb({ autoCreateForeignKeyIndices: true });
const pgAdapter = mem.adapters.createPg();

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'pg') return pgAdapter;
  return origLoad.call(this, request, ...rest);
};

// В http/duel-режимах подменяем middleware/auth заглушкой (пользователь из global)
if (MODE === 'http' || MODE === 'duel') {
  const origResolve = Module._resolveFilename;
  const AUTH_STUB = path.join(__dirname, 'auth-stub.cjs');
  Module._resolveFilename = function (request, parent, ...rest) {
    const resolved = origResolve.call(this, request, parent, ...rest);
    if (resolved === path.join(BACKEND, 'src/api/middleware/auth.ts')) return AUTH_STUB;
    return resolved;
  };
}

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true }
});

const DDL = [
  `CREATE TABLE users (id SERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE NOT NULL, username VARCHAR(64),
     balance DECIMAL DEFAULT 0, frozen_balance DECIMAL DEFAULT 0, referred_by INTEGER,
     auto_safe_percent INTEGER DEFAULT 0, notif_duel BOOLEAN DEFAULT TRUE, notif_safe BOOLEAN DEFAULT TRUE,
     notif_referral BOOLEAN DEFAULT TRUE, notif_vault BOOLEAN DEFAULT TRUE, notified_dead BOOLEAN DEFAULT FALSE,
     dead_deadline TIMESTAMP, created_at TIMESTAMP DEFAULT NOW(), last_active TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE transactions (id SERIAL PRIMARY KEY, user_id INTEGER, type VARCHAR(32), amount DECIMAL,
     balance_after DECIMAL, game_type VARCHAR(32), game_id INTEGER, description TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE safes (id SERIAL PRIMARY KEY, bank DECIMAL DEFAULT 0, prize_pool DECIMAL DEFAULT 0,
     commission_amount DECIMAL DEFAULT 0, code INTEGER[], drum_speeds DOUBLE PRECISION[],
     status VARCHAR(16) DEFAULT 'collecting', bonus BOOLEAN DEFAULT FALSE, participants_count INTEGER DEFAULT 0,
     winners_count INTEGER DEFAULT 0, commission_settled BOOLEAN DEFAULT FALSE, date DATE UNIQUE, cracked_at TIMESTAMP, crack_started_at TIMESTAMPTZ,
     collect_started_at TIMESTAMPTZ)`,
  `CREATE TABLE safe_deposits (id SERIAL PRIMARY KEY, safe_id INTEGER, user_id INTEGER, amount DECIMAL NOT NULL,
     crack_time_ms INTEGER, prize DECIMAL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(safe_id, user_id))`,
  `CREATE TABLE settings (key VARCHAR(64) PRIMARY KEY, value TEXT)`,
  `CREATE TABLE daily_revenue (id SERIAL PRIMARY KEY, date DATE NOT NULL, source VARCHAR(32) NOT NULL,
     amount DECIMAL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(date, source))`,
  `CREATE TABLE platform_cashbox (id SERIAL PRIMARY KEY, amount DECIMAL DEFAULT 500, updated_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE vault_deposits (id SERIAL PRIMARY KEY, user_id INTEGER, amount DECIMAL NOT NULL, term_days INTEGER NOT NULL,
     multiplier DECIMAL NOT NULL, days_elapsed INTEGER DEFAULT 0, accumulated_profit DECIMAL DEFAULT 0,
     status VARCHAR(16) DEFAULT 'active', created_at TIMESTAMP DEFAULT NOW(), unlocked_at TIMESTAMP, unlocks_at TIMESTAMPTZ)`,
  `CREATE TABLE vault_deposit_accruals (id SERIAL PRIMARY KEY, deposit_id INTEGER, user_id INTEGER, date DATE, pool_amount DECIMAL, profit DECIMAL, UNIQUE(deposit_id,date))`,
  `CREATE TABLE vault_pool_daily (id SERIAL PRIMARY KEY, date DATE UNIQUE NOT NULL, platform_revenue DECIMAL DEFAULT 0,
     auto_pool DECIMAL DEFAULT 0, manual_pool DECIMAL DEFAULT 0, total_pool DECIMAL DEFAULT 0,
     total_locked DECIMAL DEFAULT 0, depositors_count INTEGER DEFAULT 0, base_rate DECIMAL DEFAULT 0,
     max_deposit DECIMAL DEFAULT 100, distributed_at TIMESTAMPTZ)`,
  `CREATE TABLE rocket_rounds (id SERIAL PRIMARY KEY, user_id INTEGER, bet DECIMAL NOT NULL, crash_at DECIMAL NOT NULL,
     cashout_at DECIMAL, profit DECIMAL DEFAULT 0, flight_curve DECIMAL DEFAULT 0.075,
     was_beautiful BOOLEAN DEFAULT FALSE, replay_seed VARCHAR(64), started_at TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE rocket_bankroll (id SERIAL PRIMARY KEY, amount DECIMAL DEFAULT 1500, updated_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE duels (id SERIAL PRIMARY KEY, creator_id INTEGER, opponent_id INTEGER, target_user_id INTEGER, parent_duel_id INTEGER, amount DECIMAL,
     status VARCHAR(16) DEFAULT 'waiting', result VARCHAR(8), winner_id INTEGER, coin_trajectory JSONB,
     created_at TIMESTAMP DEFAULT NOW(), finished_at TIMESTAMP)`,
  `CREATE TABLE user_notifications (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, type VARCHAR(50) NOT NULL,
     title VARCHAR(255) NOT NULL, message TEXT NOT NULL, data JSONB, is_read BOOLEAN DEFAULT FALSE,
     created_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ, related_entity_type VARCHAR(50), related_entity_id INTEGER,
     UNIQUE(user_id,type,related_entity_type,related_entity_id))`
];

let failed = 0;
function check(label, cond, extra) {
  if (cond) console.log('  ✅', label);
  else { failed++; console.log('  ❌', label, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}
const finish = () => {
  console.log(failed === 0 ? `\n🎉 smoke/${MODE}: ПРОВЕРКИ ПРОЙДЕНЫ\n` : `\n💥 smoke/${MODE} ПРОВАЛЕНО: ${failed}\n`);
  process.exit(failed === 0 ? 0 : 1);
};

(async () => {
  for (const stmt of DDL) await mem.public.none(stmt);

  const { query } = require(path.join(BACKEND, 'src/db/pool.ts'));
  const safeSvc = require(path.join(BACKEND, 'src/services/safe.ts'));
  const { todayMSK, tomorrowMSK, nowMSK } = require(path.join(BACKEND, 'src/utils/time.ts'));

  await query(`INSERT INTO platform_cashbox (id, amount) VALUES (1, 500)`);
  await query(`INSERT INTO users (telegram_id, username, balance) VALUES (1001,'alice',1000),(1002,'bob',1000)`);

  /** Настройки: время взлома — две минуты назад (слот уже наступил), окно 2 минуты. */
  async function seedSettings() {
    const slot = new Date(nowMSK().getTime() - 2 * 60000);
    await query(`INSERT INTO settings (key, value) VALUES
      ('safe_min_bank','25'),('safe_min_participants','2'),('safe_crack_timeout_minutes','2'),
      ('min_bet','1'),('commission_percent','10'),('referral_percent','3'),
      ('safe_crack_hour',$1),('safe_crack_minute',$2)`,
      [String(slot.getHours()), String(slot.getMinutes())]);
  }

  /** Два вклада по $50 в собирающий сейф — минимум для старта взлома набран. */
  async function fundCollectingSafe() {
    const collecting = await safeSvc.getCollectingSafe();
    if (!collecting) throw new Error('нет собирающего сейфа');
    await safeSvc.safeDeposit(1, 50);
    await safeSvc.safeDeposit(2, 50);
    // «перематываем» начало сбора в прошлое: иначе защита слота решит,
    // что текущий слот уже отыгран предыдущим раундом
    await query(`UPDATE safes SET collect_started_at = $1 WHERE id = $2`,
      [new Date(Date.now() - 3 * 3600 * 1000).toISOString(), collecting.id]);
    return collecting;
  }

  /** Моменты тапов, которые действительно дают цифры кода. */
  function tapsFor(safe, fromMs = [9000, 10000, 11000]) {
    const speeds = safe.drum_speeds, code = safe.code;
    return [0, 1, 2].map(i => {
      for (let ms = fromMs[i]; ms < fromMs[i] + 60000; ms++) {
        if (safeSvc.digitAt(speeds[i], ms) === code[i]) return ms;
      }
      throw new Error('не нашёл момент для цифры ' + code[i]);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  if (MODE === 'dates') {
    console.log('\n[dates] арифметика дат сейфа (TZ=Europe/Moscow)');
    const { nextSafeDate, toDateStr } = safeSvc;

    // В контейнере TZ=Europe/Moscow, и живая pg отдаёт DATE как Date в ЛОКАЛЬНОЙ
    // полночи. Наивный setUTCDate(+1) + toISOString() сдвигал дату на день назад,
    // следующий сейф получал сегодняшнюю дату, INSERT упирался в UNIQUE(date) —
    // и цепочка раундов обрывалась навсегда.
    check('Date в локальной полночи (как отдаёт pg) → следующий день',
      nextSafeDate(new Date(2026, 8, 12), '2026-09-12') === '2026-09-13',
      nextSafeDate(new Date(2026, 8, 12), '2026-09-12'));
    check('строка YYYY-MM-DD → следующий день',
      nextSafeDate('2026-09-12', '2026-09-12') === '2026-09-13', nextSafeDate('2026-09-12', '2026-09-12'));
    check('строка с временем → только дата',
      nextSafeDate('2026-09-12T21:00:00.000Z', '2026-09-12') === '2026-09-13',
      nextSafeDate('2026-09-12T21:00:00.000Z', '2026-09-12'));
    check('переход месяца', nextSafeDate('2026-09-30', '2026-09-30') === '2026-10-01',
      nextSafeDate('2026-09-30', '2026-09-30'));
    check('переход года', nextSafeDate('2026-12-31', '2026-12-31') === '2027-01-01',
      nextSafeDate('2026-12-31', '2026-12-31'));
    check('пустая таблица → завтра', nextSafeDate(null, todayMSK()) === tomorrowMSK(),
      [nextSafeDate(null, todayMSK()), tomorrowMSK()]);
    check('максимум в прошлом (сервер долго стоял) → сегодня, не в прошлом',
      nextSafeDate('2026-09-01', '2026-09-12') === '2026-09-12', nextSafeDate('2026-09-01', '2026-09-12'));
    check('toDateStr из Date берёт локальные компоненты',
      toDateStr(new Date(2026, 8, 12), 'x') === '2026-09-12', toDateStr(new Date(2026, 8, 12), 'x'));
    check('toDateStr из мусора → запасная дата', toDateStr('не дата', '2026-01-01') === '2026-01-01',
      toDateStr('не дата', '2026-01-01'));
    return finish();
  }

  // ══════════════════════════════════════════════════════════════════════
  if (MODE === 'chain') {
    console.log('\n[chain] цепочка сейфов: раунды идут бесконечно');
    await seedSettings();
    const { runSafeTick } = require(path.join(BACKEND, 'src/cron/index.ts'));

    await safeSvc.createDailySafe();
    let lastCrackDate = '';
    let prevDate = null;

    for (let round = 1; round <= 4; round++) {
      const collecting = await fundCollectingSafe();
      if (prevDate) {
        check(`раунд ${round}: дата нового сейфа позже предыдущего`,
          new Date(collecting.date) > new Date(prevDate), [String(prevDate), String(collecting.date)]);
      }
      prevDate = collecting.date;

      lastCrackDate = await runSafeTick(lastCrackDate);
      const cracking = await safeSvc.getSafeById(collecting.id);
      check(`раунд ${round}: сейф #${collecting.id} ушёл во взлом`, cracking.status === 'cracking', cracking.status);
      check(`раунд ${round}: окно взлома открыто (2 минуты из настройки)`,
        (await safeSvc.getCrackRemainingMs(collecting.id)) > 115000,
        await safeSvc.getCrackRemainingMs(collecting.id));

      // Следующий сейф создаётся сразу, сбор не прерывается ни на минуту
      const next = await safeSvc.getCollectingSafeOrNull();
      check(`раунд ${round}: следующий сейф уже собирает (#${next?.id}, ${String(next?.date).slice(0, 15)})`,
        !!next && next.id !== collecting.id, next && { id: next.id, date: next.date });

      // Оба участника сдали → итоги досрочно, не дожидаясь конца окна
      await safeSvc.submitCrackTime(1, 5000 + round * 10);
      await safeSvc.submitCrackTime(2, 9000 + round * 10);
      const done = await safeSvc.getSafeById(collecting.id);
      check(`раунд ${round}: итоги подведены досрочно (статус finished)`, done.status === 'finished', done.status);
      check(`раунд ${round}: приз получили оба`, done.winners_count === 2, done.winners_count);

      const results = await safeSvc.getSafeResults(collecting.id);
      const first = results.find(r => r.user_id === 1);
      check(`раунд ${round}: первый сдавший получил полный приз ×1.5`, first.prize === 75, first.prize);
    }

    const total = (await query(`SELECT COUNT(*)::int AS c FROM safes`)).rows[0].c;
    const cols = (await query(`SELECT COUNT(*)::int AS c FROM safes WHERE status = 'collecting'`)).rows[0].c;
    const played = (await query(`SELECT COUNT(*)::int AS c FROM safes WHERE status = 'finished'`)).rows[0].c;
    check('после 4 раундов: 5 сейфов, 4 разыграно, один собирает',
      total === 5 && cols === 1 && played === 4, { total, cols, played });
    return finish();
  }

  // ══════════════════════════════════════════════════════════════════════
  if (MODE === 'crack') {
    console.log('\n[crack] приём результата взлома');
    await seedSettings();
    await query(`INSERT INTO users (telegram_id, username, balance) VALUES (1003,'carol',1000)`);
    const collecting = await fundCollectingSafe();
    await safeSvc.safeDeposit(3, 50); // carol тоже участвует

    await safeSvc.startCracking();
    const safe = await safeSvc.getSafeById(collecting.id);
    check('взлом стартовал', safe.status === 'cracking', safe.status);

    // ── ОБЩИЙ старт вращения: один абсолютный момент на всех игроков ──────
    // Раньше каждый клиент запускал отсчёт 3-2-1 от момента собственного
    // монтирования экрана, и один игрок уже вводил шифр, пока другой досматривал
    // «3…2…1». Теперь момент старта считает сервер от crack_started_at.
    const spinLead = await safeSvc.getSpinLeadMs();
    check('разгон до общего старта: 6 с при окне 2 минуты', spinLead === 6000, spinLead);
    check('разгон не съедает окно (меньше 20% и не больше 6 с)',
      spinLead <= 6000 && spinLead <= Math.round(120000 * 0.2), spinLead);

    const startedRow = (await query(`SELECT crack_started_at FROM safes WHERE id = $1`, [collecting.id])).rows[0];
    const startedMs = new Date(startedRow.crack_started_at).getTime();
    const spinIn = await safeSvc.getSpinStartInMs(collecting.id);
    const anchor = Date.now() + spinIn;
    check('общий старт = crack_started_at + разгон (по серверным часам)',
      Math.abs(anchor - (startedMs + spinLead)) <= 50,
      { delta: anchor - (startedMs + spinLead), spinIn });
    const remain = await safeSvc.getCrackRemainingMs(collecting.id);
    check('общий старт раньше конца окна', spinIn > 0 && spinIn < remain, { spinIn, remain });

    const spinIn2 = await safeSvc.getSpinStartInMs(collecting.id);
    check('остаток до общего старта убывает (а не назначается заново)',
      spinIn2 < spinIn && spinIn - spinIn2 < 500, { spinIn, spinIn2 });

    // Короткое окно: разгон урезается, чтобы церемония не съела всё время
    check('для окна 7.5 с разгон урезается до 1.5 с', (await safeSvc.getSpinLeadMs(7500)) === 1500,
      await safeSvc.getSpinLeadMs(7500));

    // Опоздавший игрок (полёт ракеты, фоновая вкладка): общий старт уже прошёл —
    // остаток отрицательный, клиент не рисует фейковый отсчёт, а сразу крутит барабаны
    await query(`UPDATE safes SET crack_started_at = $1 WHERE id = $2`,
      [new Date(Date.now() - 9000).toISOString(), collecting.id]);
    const spinLate = await safeSvc.getSpinStartInMs(collecting.id);
    check('опоздавший игрок: остаток до общего старта отрицательный',
      spinLate < 0 && spinLate > -9000, spinLate);
    await query(`UPDATE safes SET crack_started_at = $1 WHERE id = $2`,
      [typeof startedRow.crack_started_at === 'string'
        ? startedRow.crack_started_at
        : new Date(startedRow.crack_started_at).toISOString(), collecting.id]);
    check('после восстановления отметки общий старт снова в будущем',
      (await safeSvc.getSpinStartInMs(collecting.id)) > 0,
      await safeSvc.getSpinStartInMs(collecting.id));

    // 1) Посторонний (без вклада) результат сдать не может
    await query(`INSERT INTO users (telegram_id, username, balance) VALUES (1004,'dave',0)`);
    let err = null;
    try { await safeSvc.submitCrackTime(4, 1000); } catch (e) { err = e.message; }
    check('игрок без вклада отклонён', typeof err === 'string' && /Нет вклада/.test(err), err);

    // 2) Тапы с чужими цифрами отклоняются, и временем НЕ штрафуются
    const good = tapsFor(safe);
    const bad = good.map((t, i) => { let ms = t; do { ms += 1; } while (safeSvc.digitAt(safe.drum_speeds[i], ms) === safe.code[i]); return ms; });
    err = null;
    try { await safeSvc.submitCrackTime(3, 1500, bad); } catch (e) { err = e.message; }
    check('чужие цифры отклонены', typeof err === 'string' && /не совпадают/i.test(err), err);
    const afterReject = await safeSvc.getUserSafeDeposit(collecting.id, 3);
    check('отклонённый результат не записан (можно попробовать снова)',
      afterReject.crack_time_ms == null, afterReject);

    // 3) Правильные тапы: засчитано ровно max(taps), заявленное время не улучшает результат
    const maxGood = Math.max(...good);
    const rBob = await safeSvc.submitCrackTime(2, 1000, good);
    check('заявленные 1000 мс не прошли — засчитано по тапам', rBob.crack_time_ms === maxGood,
      [rBob.crack_time_ms, maxGood]);
    check('штрафа за промахи нет (время = max(taps), без +0.5 с)',
      rBob.crack_time_ms === maxGood && !/500/.test(String(rBob.crack_time_ms)), rBob.crack_time_ms);

    // 4) Повторная отправка не перезаписывает результат
    const again = await safeSvc.submitCrackTime(2, 4000, good);
    check('повтор → already_recorded, время прежнее',
      again.already_recorded === true && again.crack_time_ms === maxGood, again);

    // 5) Мусор вместо тапов — считается только время клиента, но не лучше серверного
    const rCarol = await safeSvc.submitCrackTime(3, 30000, 'не массив');
    check('мусор вместо тапов принят (время клиента)', rCarol.recorded === true, rCarol);

    // 6) Окно закрылось — результат не принимается
    await query(`UPDATE safes SET crack_started_at = $1 WHERE id = $2`,
      [new Date(Date.now() - 10 * 60000).toISOString(), collecting.id]);
    err = null;
    try { await safeSvc.submitCrackTime(1, 5000, tapsFor(safe, [1000, 2000, 3000])); } catch (e) { err = e.message; }
    check('после закрытия окна результат отклонён', typeof err === 'string' && /закрыто/i.test(err), err);

    // 7) Дедлайн подводит итоги: не сдавший получает техническое поражение
    const finalized = await safeSvc.finalizeCracking(collecting.id);
    check('итоги подведены по дедлайну', finalized === collecting.id, finalized);
    const results = await safeSvc.getSafeResults(collecting.id);
    const alice = results.find(r => r.user_id === 1);
    check('не сдавший: crack_time_ms пустой и приз 0',
      alice.crack_time_ms == null && alice.prize === 0, alice);
    const bob = results.find(r => r.user_id === 2);
    check('сдавший первым: полный приз ×1.5', bob.prize === 75, bob);
    return finish();
  }

  // ══════════════════════════════════════════════════════════════════════
  if (MODE === 'http') {
    console.log('\n[http] маршруты: /api/safe/current, /api/stats/summary, /api/admin/settings, токены');
    await seedSettings();
    // Время взлома для подписи «взлом в HH:MM МСК» — завтра 21:00
    await query(`UPDATE settings SET value = '21' WHERE key = 'safe_crack_hour'`);
    await query(`UPDATE settings SET value = '0' WHERE key = 'safe_crack_minute'`);

    const express = require('express');
    const safeRouter = require(path.join(BACKEND, 'src/api/routes/safe.ts')).default;
    const adminRouter = require(path.join(BACKEND, 'src/api/routes/admin.ts')).default;
    const userRouter = require(path.join(BACKEND, 'src/api/routes/user.ts')).default;

    const app = express();
    app.use(express.json());
    app.use('/api/safe', safeRouter);
    app.use('/api/admin', adminRouter);
    app.use('/api', userRouter);

    const server = await new Promise(r => { const srv = app.listen(0, '127.0.0.1', () => r(srv)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        headers: { 'content-type': 'application/json', 'x-admin-password': 'admin' },
        body: body ? JSON.stringify(body) : undefined
      });
      let json = null;
      try { json = await res.json(); } catch {}
      return { status: res.status, json };
    };

    await safeSvc.createDailySafe();
    const collecting = await fundCollectingSafe();

    let r = await call('GET', '/api/safe/current');
    check('/api/safe/current → 200', r.status === 200, r);
    check('собирающий сейф и вклад участника на месте',
      r.json?.collecting_safe?.id === collecting.id && !!r.json?.my_collecting_deposit, r.json?.collecting_safe);
    check('время взлома подписано часами МСК (HH:MM)',
      /^\d{1,2}:\d{2}$/.test(r.json?.collecting_safe?.crack_at_msk || ''), r.json?.collecting_safe?.crack_at_msk);
    check('отсчёт до взлома положительный',
      Number(r.json?.collecting_safe?.time_to_crack_ms) > 0, r.json?.collecting_safe?.time_to_crack_ms);

    // ── Раунд разыгран: итоги и сбор следующего видны одновременно ──────
    await safeSvc.startCracking();
    r = await call('GET', '/api/safe/current');
    check('во время взлома: окно и остаток в ответе',
      r.json?.safe?.status === 'cracking' && Number(r.json?.safe?.crack_remaining_ms) > 0, r.json?.safe?.status);
    check('во время взлома сбор следующего сейфа виден',
      r.json?.collecting_safe && r.json.collecting_safe.id !== collecting.id, r.json?.collecting_safe?.id);
    check('сколько участников ещё не сдали', r.json?.safe?.pending_cracks === 2, r.json?.safe?.pending_cracks);

    // Общий старт мини-игры: клиент получает остаток в мс от серверных часов
    check('во время взлома: остаток до общего старта в ответе',
      typeof r.json?.safe?.crack_spin_in_ms === 'number'
        && r.json.safe.crack_spin_in_ms <= Number(r.json.safe.crack_remaining_ms),
      { spin: r.json?.safe?.crack_spin_in_ms, left: r.json?.safe?.crack_remaining_ms });
    check('разгон и момент показа кода отданы клиенту',
      Number(r.json?.safe?.crack_spin_lead_ms) > 0 && Number(r.json?.safe?.crack_code_lead_ms) > 0,
      { lead: r.json?.safe?.crack_spin_lead_ms, code: r.json?.safe?.crack_code_lead_ms });
    check('server_now в ответе — клиент правит расхождение своих часов',
      Math.abs(Number(r.json?.server_now) - Date.now()) < 5000, r.json?.server_now);

    // Два «игрока» опрашивают сервер в разные моменты — абсолютный старт один и тот же
    const rA = await call('GET', '/api/safe/current'); const tA = Date.now();
    const rB = await call('GET', '/api/safe/current'); const tB = Date.now();
    const anchorA = tA + Number(rA.json?.safe?.crack_spin_in_ms);
    const anchorB = tB + Number(rB.json?.safe?.crack_spin_in_ms);
    check('оба игрока выводят один момент общего старта (±100 мс)',
      Math.abs(anchorA - anchorB) <= 100, { delta: anchorA - anchorB });

    const safeNow = await safeSvc.getSafeById(collecting.id);
    const good = tapsFor(safeNow);
    global.__STUB_USER__ = { id: 1, role: 'admin', username: 'alice' };
    r = await call('POST', '/api/safe/crack', { time_ms: 1000, taps: good });
    check('результат alice принят, ждём второго', r.json?.recorded === true && r.json?.waiting === 1, r.json);

    // Ближайший момент, когда цифра барабана уже другая — честные «чужие» тапы
    const bad = good.map((t, i) => {
      let ms = t;
      do { ms += 1; } while (safeSvc.digitAt(safeNow.drum_speeds[i], ms) === safeNow.code[i]);
      return ms;
    });
    global.__STUB_USER__ = { id: 2, role: 'user', username: 'bob' };
    r = await call('POST', '/api/safe/crack', { time_ms: 1500, taps: bad });
    check('чужие цифры → 400 с понятной ошибкой',
      r.status === 400 && /не совпадают/i.test(r.json?.error || ''), [r.status, r.json]);
    r = await call('POST', '/api/safe/crack', { time_ms: 12000, taps: tapsFor(await safeSvc.getSafeById(collecting.id), [12000, 13000, 14000]) });
    check('bob сдал правильно → итоги досрочно', r.json?.finished === true, r.json);

    global.__STUB_USER__ = { id: 1, role: 'admin', username: 'alice' };
    r = await call('GET', '/api/safe/current');
    check('после розыгрыша: последний раунд с кодом и призами',
      r.json?.last_finished?.id === collecting.id && r.json?.last_finished?.code?.length === 3, r.json?.last_finished);
    check('приз alice — из БД: полный ×1.5 за первую сдачу',
      Number(r.json?.my_last_deposit?.prize) === 75, r.json?.my_last_deposit);

    global.__STUB_USER__ = { id: 2, role: 'user', username: 'bob' };
    r = await call('GET', '/api/safe/current');
    check('приз bob — из БД: меньше полного (сдал позже)',
      Number(r.json?.my_last_deposit?.prize) < 75 && Number(r.json?.my_last_deposit?.prize) > 0,
      r.json?.my_last_deposit);
    check('сбор следующего сейфа продолжается',
      r.json?.collecting_safe?.status === 'collecting', r.json?.collecting_safe);

    // ── «Активного» сейфа нет — сбор и итоги всё равно отдаются ──────────
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await query(`UPDATE safes SET date = $1 WHERE id = $2`, [yesterday, collecting.id]);
    r = await call('GET', '/api/safe/current');
    check('без активного сейфа collecting_safe всё равно есть',
      r.status === 200 && !!r.json?.collecting_safe, r.json?.collecting_safe);
    check('без активного сейфа last_finished не теряется',
      r.json?.last_finished?.id === collecting.id, r.json?.last_finished?.id);
    check('safe = null (взлома и сегодняшнего сейфа нет)', r.json?.safe === null, r.json?.safe);

    // ── Витрина проекта ────────────────────────────────────────────────
    await query(`INSERT INTO transactions (user_id, type, amount) VALUES
      (1,'deposit',100),(2,'demo_deposit',50),(1,'withdraw',-30),(1,'bet',-10),(2,'win',20)`);
    r = await call('GET', '/api/stats/summary');
    check('/api/stats/summary → 200', r.status === 200, r);
    const usersCount = (await query(`SELECT COUNT(*)::int AS c FROM users`)).rows[0].c;
    check('участников = числу пользователей', r.json?.users_count === usersCount, [r.json?.users_count, usersCount]);
    check('пополнено 150 (deposit + demo_deposit; ставки и выигрыши не в счёт)',
      r.json?.total_deposited === 150, r.json);
    check('выплачено 30 (выводы по модулю)', r.json?.total_withdrawn === 30, r.json);
    check('дата старта по умолчанию 2026-01-01, дней работаем > 200',
      r.json?.project_start === '2026-01-01' && r.json?.days_working > 200, r.json);

    const recent = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    await query(`INSERT INTO settings (key, value) VALUES ('project_start_date', $1)`, [recent]);
    r = await call('GET', '/api/stats/summary');
    check('дата старта из настроек применяется (дней 3-4)',
      r.json?.project_start === recent && (r.json?.days_working === 3 || r.json?.days_working === 4), r.json);

    // ── Настройки админки: группы и подписи ────────────────────────────
    r = await call('GET', '/api/admin/settings');
    check('настройки разложены по группам', Array.isArray(r.json?.groups) && r.json.groups.length === 5,
      r.json?.groups?.map(g => g.title));
    check('в группе «Сейф» время и дедлайн взлома',
      r.json?.groups?.[0]?.keys?.includes('safe_crack_timeout_minutes') &&
      r.json?.groups?.[0]?.keys?.includes('safe_crack_hour'), r.json?.groups?.[0]);
    check('дедлайн подписан «Нужно взломать сейф за (минуты)»',
      /Нужно взломать сейф за/.test(r.json?.labels?.safe_crack_timeout_minutes || ''),
      r.json?.labels?.safe_crack_timeout_minutes);
    const grouped = new Set((r.json?.groups || []).flatMap(g => g.keys));
    check('ни одна настройка не потерялась между группами',
      Object.keys(r.json?.values || {}).every(k => grouped.has(k)),
      Object.keys(r.json?.values || {}).filter(k => !grouped.has(k)));

    // ── Токен привязан к человеку, а не к номеру строки ────────────────
    // Реальный случай: браузер хранил токен старого аккаунта, БД пересоздали,
    // тот же id достался другому человеку — и «нулевой» аккаунт сыграл чужой вклад.
    const { getUserFromToken } = require(path.join(BACKEND, 'src/services/user.ts'));
    const jwt = require('jsonwebtoken');
    const { config } = require(path.join(BACKEND, 'src/config.ts'));
    const alice = (await query(`SELECT id, telegram_id FROM users WHERE username = 'alice'`)).rows[0];
    check('свой токен принимается',
      (await getUserFromToken(jwt.sign({ userId: alice.id, telegramId: Number(alice.telegram_id) }, config.jwtSecret)))?.id === alice.id);
    check('токен с чужим telegram_id отклонён (клиент войдёт заново)',
      (await getUserFromToken(jwt.sign({ userId: alice.id, telegramId: Number(alice.telegram_id) + 777 }, config.jwtSecret))) === null);
    check('старый формат токена (без telegram_id) продолжает работать',
      (await getUserFromToken(jwt.sign({ userId: alice.id }, config.jwtSecret)))?.id === alice.id);
    check('мусор вместо токена отклонён', (await getUserFromToken('abc.def.ghi')) === null);

    server.close();
    return finish();
  }

  // ══════════════════════════════════════════════════════════════════════
  if (MODE === 'duel') {
    console.log('\n[duel] уведомления о результатах дуэлей, очередь реплеев, деньги вызова');
    await seedSettings();

    const express = require('express');
    const duelRouter = require(path.join(BACKEND, 'src/api/routes/duel.ts')).default;
    const duelSvc = require(path.join(BACKEND, 'src/services/duel.ts'));

    const app = express();
    app.use(express.json());
    app.use('/api/duel', duelRouter);
    const server = await new Promise(r => { const srv = app.listen(0, '127.0.0.1', () => r(srv)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        headers: { 'content-type': 'application/json', 'x-admin-password': 'admin' },
        body: body ? JSON.stringify(body) : undefined
      });
      let json = null;
      try { json = await res.json(); } catch {}
      return { status: res.status, json };
    };
    const as = (id, username) => { global.__STUB_USER__ = { id, role: 'user', username }; };
    // Монета детерминированная: Math.random() < 0.5 → «орёл» → побеждает создатель.
    // Без этого проверки денег и i_won плавали бы от запуска к запуску.
    const origRandom = Math.random;
    Math.random = () => 0.1;
    const countFor = async (userId, extra = '') =>
      (await query(`SELECT COUNT(*)::int AS c FROM user_notifications
                     WHERE user_id = $1 AND type = 'duel_result' ${extra}`, [userId])).rows[0].c;

    // ── Деньги открытого вызова: заморозка, а не двойное списание ─────────
    as(1, 'alice');
    let r = await call('POST', '/api/duel/create', { amount: 25 });
    const duel1 = r.json?.duel_id;
    check('вызов создан', r.status === 200 && Number.isFinite(duel1), r.json);
    const u1 = (await query(`SELECT balance, frozen_balance FROM users WHERE id = 1`)).rows[0];
    check('открытый вызов: баланс не списан, ставка заморожена',
      Number(u1.balance) === 1000 && Number(u1.frozen_balance) === 25, u1);
    const { getAvailableBalance } = require(path.join(BACKEND, 'src/services/balance.ts'));
    check('доступно ровно 975 (раньше было 950 — ставка блокировалась дважды)',
      (await getAvailableBalance(1)) === 975, await getAvailableBalance(1));

    // Отмена возвращает заморозку и не плодит транзакций
    as(1, 'alice');
    const duelCancel = (await call('POST', '/api/duel/create', { amount: 10 })).json?.duel_id;
    await call('POST', `/api/duel/cancel/${duelCancel}`);
    const uCancel = (await query(`SELECT balance, frozen_balance FROM users WHERE id = 1`)).rows[0];
    check('отмена вызова: разморожено, баланс прежний',
      Number(uCancel.balance) === 1000 && Number(uCancel.frozen_balance) === 25, uCancel);
    r = await call('GET', '/api/duel/notifications');
    check('ожидающая и отменённая дуэли уведомлений не создают',
      (r.json?.notifications || []).length === 0, r.json);

    // ── Дуэль сыграна: уведомления ОБИМ участникам ───────────────────────
    as(2, 'bob');
    r = await call('POST', `/api/duel/accept/${duel1}`);
    check('дуэль принята и сыграна', r.status === 200 && ['heads', 'tails'].includes(r.json?.result), r.json);
    const winnerId = r.json?.winner;
    check('победитель — создатель вызова (монета детерминированная)', winnerId === 1, winnerId);

    const aliceMoney = (await query(`SELECT balance, frozen_balance FROM users WHERE id = 1`)).rows[0];
    check('после игры у создателя ставка списана, выигрыш начислен, ничего не заморожено',
      Number(aliceMoney.balance) === 1020 && Number(aliceMoney.frozen_balance) === 0, aliceMoney);
    const bobMoney = (await query(`SELECT balance, frozen_balance FROM users WHERE id = 2`)).rows[0];
    check('проигравший соперник: ставка списана, заморозки нет',
      Number(bobMoney.balance) === 975 && Number(bobMoney.frozen_balance) === 0, bobMoney);
    check('у обоих участников ровно по одной записи уведомления',
      (await countFor(1)) === 1 && (await countFor(2)) === 1,
      [await countFor(1), await countFor(2)]);

    const nAlice = (await query(`SELECT * FROM user_notifications WHERE user_id = 1 AND type = 'duel_result'`)).rows[0];
    const dAlice = nAlice.data;
    check('в уведомлении есть всё для модалки: duel_id, ставка, приз, i_won, соперник, траектория',
      Number(dAlice.duel_id) === duel1 && Number(dAlice.amount) === 25 && Number(dAlice.prize) === 45
        && typeof dAlice.i_won === 'boolean' && dAlice.opponent_name === '@bob'
        && !!dAlice.coin_trajectory && dAlice.winner_id === winnerId,
      dAlice);
    check('i_won честный: создателю — победа, сопернику — поражение',
      dAlice.i_won === true, dAlice.i_won);
    const nBob = (await query(`SELECT data FROM user_notifications WHERE user_id = 2 AND type = 'duel_result'`)).rows[0];
    check('в уведомлении соперника i_won = false и соперник = @alice',
      nBob.data.i_won === false && nBob.data.opponent_name === '@alice', nBob.data);

    // ── Список непрочитанных и идемпотентность досоздания ────────────────
    as(1, 'alice');
    r = await call('GET', '/api/duel/notifications');
    check('непрочитанных у создателя ровно одно', (r.json?.notifications || []).length === 1, r.json);
    check('в списке — данные дуэли (клиент рисует из них модалку)',
      Number(r.json?.notifications?.[0]?.data?.duel_id) === duel1, r.json?.notifications?.[0]);
    await call('GET', '/api/duel/notifications');
    await call('GET', '/api/duel/notifications');
    check('повторные запросы списка не плодят дубли', (await countFor(1)) === 1, await countFor(1));
    check('досоздание не трогает второго участника', (await countFor(2)) === 1, await countFor(2));

    // ── Игрок зашёл спустя дни: потерянное уведомление воссоздаётся ──────
    await query(`DELETE FROM user_notifications WHERE user_id = 1 AND type = 'duel_result'`);
    r = await call('GET', '/api/duel/notifications');
    check('потерянное уведомление досоздано при следующем запросе (игрок вернулся позже)',
      (r.json?.notifications || []).length === 1 && Number(r.json.notifications[0].data?.duel_id) === duel1,
      r.json);

    // ── Несколько дуэлей подряд → очередь из нескольких уведомлений ──────
    as(1, 'alice');
    const duel2 = (await call('POST', '/api/duel/create', { amount: 10 })).json?.duel_id;
    as(2, 'bob');
    await call('POST', `/api/duel/accept/${duel2}`);
    as(1, 'alice');
    r = await call('GET', '/api/duel/notifications');
    check('две сыгранные дуэли → два уведомления в очереди',
      (r.json?.notifications || []).length === 2, (r.json?.notifications || []).length);
    r = await call('GET', '/api/duel/notifications/count');
    check('счётчик непрочитанных = 2 (бейдж)', r.json?.count === 2, r.json);

    // «Закрыть» гасит одну дуэль, вторая остаётся ждать
    await call('POST', `/api/duel/notifications/read-duel/${duel1}`);
    r = await call('GET', '/api/duel/notifications');
    check('закрытая дуэль больше не придёт, вторая осталась в очереди',
      (r.json?.notifications || []).length === 1 && Number(r.json.notifications[0].data?.duel_id) === duel2,
      (r.json?.notifications || []).map(n => n.data?.duel_id));
    check('прочитанное не удаляется из БД — модалка не воскреснет',
      (await countFor(1, 'AND is_read = TRUE')) === 1, await countFor(1, 'AND is_read = TRUE'));
    r = await call('GET', '/api/duel/notifications');
    check('досоздание не воскрешает закрытое уведомление',
      (r.json?.notifications || []).length === 1, (r.json?.notifications || []).length);

    await call('POST', '/api/duel/notifications/read-all');
    r = await call('GET', '/api/duel/notifications');
    check('«отметить всё прочитанным» очищает очередь', (r.json?.notifications || []).length === 0, r.json);

    // ── Реплей: всё нужное для повторного броска монеты ──────────────────
    r = await call('GET', `/api/duel/${duel1}`);
    check('реплей отдаёт результат, приз, траекторию и i_won',
      r.json?.id === duel1 && ['heads', 'tails'].includes(r.json?.result) && Number(r.json?.prize) === 45
        && !!r.json?.coin_trajectory && typeof r.json?.i_won === 'boolean' && r.json?.status === 'finished',
      r.json);
    as(2, 'bob');
    const rBob = await call('GET', `/api/duel/${duel1}`);
    check('i_won в реплее считается под того, кто смотрит',
      r.json?.i_won === true && rBob.json?.i_won === false, [r.json?.i_won, rBob.json?.i_won]);

    // ── Деньги дуэли: банк 2×ставка, комиссия 10%, приз 90% ──────────────
    const totalPaid = (await query(
      `SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type = 'win' AND game_type = 'duel'`)).rows[0];
    check('победителю выплачен приз 90% от банка (45 + 18 за вторую дуэль)',
      Math.round(Number(totalPaid.s)) === 63, totalPaid.s);
    const revenue = (await query(
      `SELECT COALESCE(SUM(amount),0) AS s FROM daily_revenue WHERE source = 'duel'`)).rows[0];
    check('комиссия платформы 10% с обеих дуэлей записана',
      Math.round(Number(revenue.s) * 100) / 100 === 7, revenue.s);
    const finalAlice = (await query(`SELECT balance FROM users WHERE id = 1`)).rows[0];
    const finalBob = (await query(`SELECT balance FROM users WHERE id = 2`)).rows[0];
    check('итог двух дуэлей: alice 1028, bob 965 (ноль не пропал)',
      Number(finalAlice.balance) === 1028 && Number(finalBob.balance) === 965,
      [finalAlice.balance, finalBob.balance]);

    // ── Починка вызовов, созданных прежним кодом (заморозка + списание) ──
    // Имитируем «старую» дуэль в лобби: ставка и заморожена, и списана.
    const oldDuel = (await query(
      `INSERT INTO duels (creator_id, amount, status) VALUES (2, 20, 'waiting') RETURNING id`)).rows[0];
    await query(`UPDATE users SET frozen_balance = frozen_balance + 20, balance = balance - 20 WHERE id = 2`);
    const before = (await query(`SELECT balance, frozen_balance FROM users WHERE id = 2`)).rows[0];
    check('старый вызов блокировал ставку дважды (available 925 вместо 945)',
      Number(before.balance) === 945 && Number(before.frozen_balance) === 20, before);

    const repaired = await duelSvc.repairDoubleLockedOpenDuels();
    const after = (await query(`SELECT balance, frozen_balance FROM users WHERE id = 2`)).rows[0];
    check('починка вернула ставку на баланс, заморозка осталась одна', repaired === 1
      && Number(after.balance) === 965 && Number(after.frozen_balance) === 20, [repaired, after]);
    const again = await duelSvc.repairDoubleLockedOpenDuels();
    const after2 = (await query(`SELECT balance FROM users WHERE id = 2`)).rows[0];
    check('повторный запуск (рестарт контейнера) деньги второй раз не возвращает',
      again === 0 && Number(after2.balance) === 965, [again, after2.balance]);
    const unlockTx = (await query(
      `SELECT COUNT(*) AS c FROM transactions WHERE type = 'duel_unlock' AND game_id = ${oldDuel.id}`)).rows[0];
    check('возврат отмечен транзакцией duel_unlock', Number(unlockTx.c) === 1, unlockTx.c);
    // Отремонтированный старый вызов можно отменить — деньги возвращаются целиком
    as(2, 'bob');
    await call('POST', `/api/duel/cancel/${oldDuel.id}`);
    const cancelled = (await query(`SELECT balance, frozen_balance FROM users WHERE id = 2`)).rows[0];
    check('отмена старого вызова после починки: 965 на балансе, заморозки нет',
      Number(cancelled.balance) === 965 && Number(cancelled.frozen_balance) === 0, cancelled);

    // ── Гонка «Принять»: одна дуэль не должна сыграться дважды ───────────
    // Двойной клик, два устройства или два игрока на одну строку лобби.
    await query(`INSERT INTO users (id, telegram_id, username, balance, frozen_balance)
                 VALUES (3, 3003, 'carol', 100, 0)`);
    as(2, 'bob');
    const raceId = (await call('POST', '/api/duel/create', { amount: 20 })).json?.duel_id;
    const race = await Promise.all([
      duelSvc.acceptDuel(raceId, 1).then(v => ({ ok: true, v })).catch(e => ({ ok: false, msg: e.message })),
      duelSvc.acceptDuel(raceId, 3).then(v => ({ ok: true, v })).catch(e => ({ ok: false, msg: e.message }))
    ]);
    check('два одновременных «Принять»: сыграла только одна дуэль',
      race.filter(x => x.ok).length === 1, race.map(x => (x.ok ? 'ok' : x.msg)));
    const paidTx = (await query(
      `SELECT COUNT(*)::int AS c FROM transactions WHERE type = 'bet' AND game_id = ${raceId}`)).rows[0];
    check('ставки списаны по одной на игрока (2, а не 4)', Number(paidTx.c) === 2, paidTx.c);
    const winTx = (await query(
      `SELECT COUNT(*)::int AS c FROM transactions WHERE type = 'win' AND game_id = ${raceId}`)).rows[0];
    check('приз выплачен один раз', Number(winTx.c) === 1, winTx.c);
    const raceDuel = (await query(`SELECT status FROM duels WHERE id = ${raceId}`)).rows[0];
    check('дуэль одна и завершена', raceDuel.status === 'finished', raceDuel.status);
    const bobRace = (await query(`SELECT balance, frozen_balance FROM users WHERE id = 2`)).rows[0];
    check('создатель: ставка 20 списана, приз 36 начислен → 981, заморозки нет',
      Number(bobRace.balance) === 981 && Number(bobRace.frozen_balance) === 0, bobRace);
    const aliceRace = Number((await query(`SELECT balance FROM users WHERE id = 1`)).rows[0].balance);
    const carolRace = Number((await query(`SELECT balance FROM users WHERE id = 3`)).rows[0].balance);
    const alicePaid = aliceRace === 1008, carolPaid = carolRace === 80;
    check('заплатил ровно один претендент, второй деньги сохранил (1028 / 100)',
      (alicePaid && carolRace === 100) || (carolPaid && aliceRace === 1028), [aliceRace, carolRace]);

    // ── Событие в сокет уходит ПОСЛЕ записи в БД ─────────────────────────
    // Раньше notify() сначала слал socket-событие и только потом писал строку:
    // клиент на событие перечитывал список, не находил уведомление, и
    // досоздание плодило дубли (в логе — два [NOTIFY] на одну дуэль).
    const notifMod = require(path.join(BACKEND, 'src/services/notifications.ts'));
    const unMod = require(path.join(BACKEND, 'src/services/user-notifications.ts'));
    const origCreate = unMod.createNotification;
    const order = [];
    unMod.createNotification = async (...a) => {
      const r = await origCreate(...a);
      order.push('db');
      return r;
    };
    notifMod.initNotifications({ to: () => ({ emit: () => order.push('socket') }) });
    await duelSvc.notifyDuelFinished(raceId); // у дуэли из гонки уведомлений ещё нет
    check('сначала запись в БД, потом событие в сокет (на каждого участника)',
      order.join(' ') === 'db socket db socket', order);
    const raceNotes = await countFor(2, `AND (data->>'duel_id') = '${raceId}'`);
    check('у создателя ровно одно уведомление о дуэли из гонки', raceNotes === 1, raceNotes);
    unMod.createNotification = origCreate;
    notifMod.initNotifications(null);

    Math.random = origRandom;
    server.close();
    return finish();
  }
  if (MODE === 'vault') {
    console.log('\n[vault] вклад: одно движение денег = одна операция (без двойной блокировки)');
    await seedSettings();
    const vaultSvc = require(path.join(BACKEND, 'src/services/vault-deposit.ts'));
    const { getAvailableBalance } = require(path.join(BACKEND, 'src/services/balance.ts'));

    // Выручка сегодня и вчера: от неё считается пул (15%) и динамический
    // максимум вклада (пул × 10), поэтому без неё тест упёрся бы в $100.
    const todayStr = nowMSK().toISOString().slice(0, 10);
    const y = new Date(nowMSK().getTime() - 86400000); y.setHours(0, 0, 0, 0);
    const yStr = y.toISOString().slice(0, 10);
    for (const d of [todayStr, yStr]) {
      await query(`INSERT INTO daily_revenue (date, source, amount) VALUES ($1, 'duel', 400)`, [d]);
    }
    const prior=new Date(y.getTime()-86400000).toISOString().slice(0,10);
    await query(`INSERT INTO vault_pool_daily(date,max_deposit,distributed_at) VALUES($1,500,NOW())`, [prior]);

    const money = async id => (await query(
      `SELECT balance, frozen_balance FROM users WHERE id = $1`, [id])).rows[0];

    // ── Блокировка вклада ────────────────────────────────────────────────
    const dep = await vaultSvc.lockVaultDeposit(1, 500, 7);
    check('вклад открыт', Number.isFinite(dep.deposit_id), dep);
    const m1 = await money(1);
    check('вклад СПИСАН, но НЕ заморожен: баланс 500, frozen 0',
      Number(m1.balance) === 500 && Number(m1.frozen_balance) === 0, m1);
    check('доступно 500 (раньше было 0 — сумма блокировалась дважды)',
      (await getAvailableBalance(1)) === 500, await getAvailableBalance(1));
    const { getBalanceSnapshot } = require(path.join(BACKEND, 'src/services/balance.ts'));
    const snapVault = await getBalanceSnapshot(1);
    check('снимок «где деньги»: во вкладе 500, в сейфе 0, заморозки нет',
      snapVault.vault_locked === 500 && snapVault.safe_locked === 0
      && snapVault.frozen_balance === 0, snapVault);
    let err = null;
    try { await vaultSvc.lockVaultDeposit(1, 100, 7); } catch (e) { err = e.message; }
    check('второй активный вклад не открывается', err === 'У вас уже есть активный вклад', err);
    err = null;
    try { await vaultSvc.lockVaultDeposit(1, 10_000, 7); } catch (e) { err = e.message; }
    check('сумма больше динамического максимума отклонена', /Максимум/.test(err || ''), err);

    // ── Досрочный возврат ────────────────────────────────────────────────
    const un = await vaultSvc.earlyUnlock(1, dep.deposit_id);
    const m2 = await money(1);
    check('досрочный возврат: тело вернулось целиком (1000), заморозки нет',
      Number(un.returned) === 500 && Number(m2.balance) === 1000 && Number(m2.frozen_balance) === 0, [un, m2]);
    check('после досрочного возврата во вкладе ничего не числится',
      (await getBalanceSnapshot(1)).vault_locked === 0, await getBalanceSnapshot(1));

    // ── Выплата в срок ───────────────────────────────────────────────────
    const dep30 = await vaultSvc.lockVaultDeposit(1, 200, 30);
    await query(`UPDATE vault_deposits SET days_elapsed = 29, unlocks_at=NOW()-INTERVAL '1 minute' WHERE id = $1`, [dep30.deposit_id]);
    const dist = await vaultSvc.dailyVaultDistribution();
    const matured = await vaultSvc.completeMatureVaultDeposits();
    const m3 = await money(1);
    // пул вчера = 400 × 15% = 60, вклад один → вся прибыль ему: 200 + 60 = 260
    check('выплата в срок: 800 + (200 тело + 60 прибыль) = 1060, заморозки нет',
      Number(m3.balance) === 1060 && Number(m3.frozen_balance) === 0, m3);
    const row = (await query(
      `SELECT status, accumulated_profit FROM vault_deposits WHERE id = $1`, [dep30.deposit_id])).rows[0];
    check('вклад закрыт с прибылью 60', row.status === 'completed' && Number(row.accumulated_profit) === 60, row);
    const pool = (await query(`SELECT total_pool, total_locked FROM vault_pool_daily WHERE date = $1`, [yStr])).rows[0];
    check('пул дня записан: 60 распределено, 200 заблокировано',
      Number(pool.total_pool) === 60 && Number(pool.total_locked) === 200, pool);
    check('отчёт о распределении', dist.distributed === 60 && dist.completed === 0 && matured === 1, dist);

    // ── Починка вкладов, открытых прежним кодом ──────────────────────────
    await query(`INSERT INTO vault_deposits (user_id, amount, term_days, multiplier, status)
                 VALUES (2, 100, 7, 1.3, 'active') RETURNING id`);
    await query(`UPDATE users SET frozen_balance = frozen_balance + 100, balance = balance - 100 WHERE id = 2`);
    const before = await money(2);
    check('старый вклад блокировал сумму дважды: доступно 800 вместо 900',
      Number(before.balance) === 900 && Number(before.frozen_balance) === 100
      && (await getAvailableBalance(2)) === 800, [before, await getAvailableBalance(2)]);
    const fixed = await vaultSvc.repairVaultFreeze();
    const after = await money(2);
    check('починка сняла лишнюю заморозку: 900 на балансе, frozen 0',
      fixed === 1 && Number(after.balance) === 900 && Number(after.frozen_balance) === 0, [fixed, after]);
    const fixedAgain = await vaultSvc.repairVaultFreeze();
    check('повторный запуск не размораживает второй раз', fixedAgain === 0 &&
      Number((await money(2)).frozen_balance) === 0, fixedAgain);
    const oldDep = (await query(`SELECT id FROM vault_deposits WHERE user_id = 2`)).rows[0];
    await vaultSvc.earlyUnlock(2, oldDep.id);
    const m4 = await money(2);
    check('старый вклад после починки возвращается целиком: 1000, заморозки нет',
      Number(m4.balance) === 1000 && Number(m4.frozen_balance) === 0, m4);

    const frozenTotal = (await query(`SELECT COALESCE(SUM(frozen_balance),0) AS s FROM users`)).rows[0];
    check('ни у кого не осталось заморозки от вкладов', Number(frozenTotal.s) === 0, frozenTotal.s);

    return finish();
  }
  if (MODE === 'money') {
    console.log('\n[money] гонки денежных операций: ракета, вклад в сейф, возврат, отмена раунда');
    await seedSettings();
    const rocketSvc = require(path.join(BACKEND, 'src/services/rocket.ts'));
    const close = (a, b) => Math.abs(a - b) < 0.005;
    const bal = async id => Number((await query(`SELECT balance FROM users WHERE id = $1`, [id])).rows[0].balance);

    await query(`INSERT INTO rocket_bankroll (id, amount) VALUES (1, 1500)`);

    // ── Ракета: два одновременных «ЗАБРАТЬ» ──────────────────────────────
    const round = await rocketSvc.placeBet(1, 100);
    check('ставка в ракету списана один раз (900 из 1000)', close(await bal(1), 900), await bal(1));
    // Точку взрыва фиксируем, иначе случайный crash_at мог бы оказаться раньше
    // нашего кэшаута и проверка ушла бы в ветку «too_late»
    await query(`UPDATE rocket_rounds SET crash_at = 50 WHERE id = $1`, [round.round_id]);
    const beforeWin = await bal(1);
    const cashouts = await Promise.all([
      rocketSvc.processCashout(round.round_id, 1, 4).then(r => ({ ok: true, r })).catch(e => ({ ok: false, msg: e.message })),
      rocketSvc.processCashout(round.round_id, 1, 4).then(r => ({ ok: true, r })).catch(e => ({ ok: false, msg: e.message }))
    ]);
    check('два одновременных «ЗАБРАТЬ»: заплатил только один запрос',
      cashouts.filter(x => x.ok).length === 1
      && cashouts.some(x => !x.ok && /Уже забрали/.test(x.msg || '')),
      cashouts.map(x => (x.ok ? x.r.result : x.msg)));
    const won = cashouts.find(x => x.ok).r;
    check('баланс вырос ровно на один выигрыш', close(await bal(1), beforeWin + won.gross_win),
      [await bal(1), beforeWin, won.gross_win]);
    const winTx = (await query(
      `SELECT COUNT(*)::int AS c FROM transactions
        WHERE user_id = 1 AND type = 'win' AND game_type = 'rocket' AND game_id = ${round.round_id}`)).rows[0];
    check('транзакция выигрыша одна', Number(winTx.c) === 1, winTx.c);
    const roundRow = (await query(`SELECT cashout_at, profit FROM rocket_rounds WHERE id = ${round.round_id}`)).rows[0];
    check('раунд отмечен как забранный с прибылью', roundRow.cashout_at != null
      && close(Number(roundRow.profit), won.gross_win - 100), roundRow);

    // ── Сейф: два одновременных вклада ──────────────────────────────────
    const safe = await safeSvc.getCollectingSafe();
    const beforeDep = await bal(2);
    const deps = await Promise.all([
      safeSvc.safeDeposit(2, 50).then(() => 'ok').catch(e => e.message),
      safeSvc.safeDeposit(2, 50).then(() => 'ok').catch(e => e.message)
    ]);
    check('два одновременных вклада приняты оба (деньги не зависли)',
      deps.every(x => x === 'ok'), deps);
    const depRow = (await query(
      `SELECT COUNT(*)::int AS c, COALESCE(SUM(amount),0) AS s
         FROM safe_deposits WHERE safe_id = ${safe.id} AND user_id = 2`)).rows[0];
    check('строка вклада одна на сумму 100', Number(depRow.c) === 1 && Number(depRow.s) === 100, depRow);
    check('баланс уменьшился ровно на 100', close(await bal(2), beforeDep - 100), [await bal(2), beforeDep]);
    const safeRow = (await query(`SELECT bank, participants_count FROM safes WHERE id = ${safe.id}`)).rows[0];
    check('банк 100, участник посчитан один раз',
      Number(safeRow.bank) === 100 && Number(safeRow.participants_count) === 1, safeRow);
    const { getBalanceSnapshot } = require(path.join(BACKEND, 'src/services/balance.ts'));
    const snapSafe = await getBalanceSnapshot(2);
    check('снимок «где деньги»: вклад в сейф 100 виден отдельно от баланса',
      snapSafe.safe_locked === 100, snapSafe);

    // ── Сейф: два одновременных возврата вклада ─────────────────────────
    const cancels = await Promise.all([
      safeSvc.cancelSafeDeposit(2).then(() => 'ok').catch(e => e.message),
      safeSvc.cancelSafeDeposit(2).then(() => 'ok').catch(e => e.message)
    ]);
    check('два одновременных возврата: сработал один',
      cancels.filter(x => x === 'ok').length === 1
      && cancels.some(x => /уже возвращён/i.test(String(x))), cancels);
    check('деньги вернулись один раз (баланс прежний)', close(await bal(2), beforeDep), await bal(2));
    const safeRow2 = (await query(`SELECT bank, participants_count FROM safes WHERE id = ${safe.id}`)).rows[0];
    check('банк и число участников вернулись к нулю',
      Number(safeRow2.bank) === 0 && Number(safeRow2.participants_count) === 0, safeRow2);
    check('после возврата вклада в сейфе ничего не числится',
      (await getBalanceSnapshot(2)).safe_locked === 0, await getBalanceSnapshot(2));

    // ── Отмена раунда, не набравшего минимум ────────────────────────────
    await safeSvc.safeDeposit(2, 10); // банк 10 < 25 и участник 1 < 2 → раунд отменяется
    const beforeRoundCancel = await bal(2);
    await Promise.all([safeSvc.startCracking(), safeSvc.startCracking()]);
    check('вклад при отмене раунда возвращён один раз',
      close(await bal(2), beforeRoundCancel + 10), [await bal(2), beforeRoundCancel]);
    const refundTx = (await query(
      `SELECT COUNT(*)::int AS c FROM transactions
        WHERE user_id = 2 AND type = 'safe_cancel' AND amount = 10`)).rows[0];
    check('транзакция возврата при отмене одна', Number(refundTx.c) === 1, refundTx.c);
    check('отменённый раунд не держит деньги: safe_locked 0',
      (await getBalanceSnapshot(2)).safe_locked === 0, await getBalanceSnapshot(2));

    // 100 000 воспроизводимых раундов: фиксированный cashout x2 должен дать
    // RTP около 90%, то есть фактический house edge около 10%.
    let rngSeed=0x36711, returned=0; const rounds=100000, target=2;
    const seededRng=()=>{ rngSeed=(Math.imul(rngSeed,1664525)+1013904223)>>>0; return rngSeed/0x100000000; };
    for(let i=0;i<rounds;i++) if(rocketSvc.calculateCrashPoint(1,1e12,seededRng)>target) returned+=target;
    const rtp=returned/rounds, houseEdge=1-rtp;
    check('Rocket: статистический тест 1000+ раундов подтверждает house edge около 10%',
      rtp>0.885 && rtp<0.915,{rounds,rtp,house_edge:houseEdge});

    return finish();
  }
})().catch(e => {
  console.error('\n💥 ОШИБКА ТЕСТА:', e);
  process.exit(1);
});
