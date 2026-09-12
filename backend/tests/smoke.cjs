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

const MODES = ['dates', 'chain', 'crack', 'http'];
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

// В http-режиме подменяем middleware/auth заглушкой (пользователь из global)
if (MODE === 'http') {
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
     auto_safe_percent INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), last_active TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE transactions (id SERIAL PRIMARY KEY, user_id INTEGER, type VARCHAR(32), amount DECIMAL,
     balance_after DECIMAL, game_type VARCHAR(32), game_id INTEGER, description TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE safes (id SERIAL PRIMARY KEY, bank DECIMAL DEFAULT 0, prize_pool DECIMAL DEFAULT 0,
     commission_amount DECIMAL DEFAULT 0, code INTEGER[], drum_speeds DOUBLE PRECISION[],
     status VARCHAR(16) DEFAULT 'collecting', bonus BOOLEAN DEFAULT FALSE, participants_count INTEGER DEFAULT 0,
     winners_count INTEGER DEFAULT 0, date DATE UNIQUE, cracked_at TIMESTAMP, crack_started_at TIMESTAMPTZ,
     collect_started_at TIMESTAMPTZ)`,
  `CREATE TABLE safe_deposits (id SERIAL PRIMARY KEY, safe_id INTEGER, user_id INTEGER, amount DECIMAL NOT NULL,
     crack_time_ms INTEGER, prize DECIMAL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(safe_id, user_id))`,
  `CREATE TABLE settings (key VARCHAR(64) PRIMARY KEY, value TEXT)`,
  `CREATE TABLE daily_revenue (id SERIAL PRIMARY KEY, date DATE NOT NULL, source VARCHAR(32) NOT NULL,
     amount DECIMAL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(date, source))`,
  `CREATE TABLE platform_cashbox (id SERIAL PRIMARY KEY, amount DECIMAL DEFAULT 500, updated_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE vault_deposits (id SERIAL PRIMARY KEY, user_id INTEGER, amount DECIMAL NOT NULL, term_days INTEGER NOT NULL,
     locked_at TIMESTAMP DEFAULT NOW(), status VARCHAR(16) DEFAULT 'active', multiplier DECIMAL DEFAULT 1)`,
  `CREATE TABLE vault_pool_daily (id SERIAL PRIMARY KEY, date DATE UNIQUE, pool DECIMAL DEFAULT 0, base_rate DECIMAL DEFAULT 0)`,
  `CREATE TABLE user_notifications (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, type VARCHAR(50) NOT NULL,
     title VARCHAR(255) NOT NULL, message TEXT NOT NULL, data JSONB, is_read BOOLEAN DEFAULT FALSE,
     created_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ, related_entity_type VARCHAR(50), related_entity_id INTEGER)`
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
        headers: { 'content-type': 'application/json' },
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
})().catch(e => {
  console.error('\n💥 ОШИБКА ТЕСТА:', e);
  process.exit(1);
});
