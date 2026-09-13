-- ═══════════════════════════════════════════════════════════════════════════
-- Проверка полноты схемы. Запускается ПОСЛЕ init.sql:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/init.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/schema-check.sql
--
-- Используется в CI (.github/workflows/ci.yml, job `schema`) и при локальной
-- проверке свежего тома. Любое расхождение — RAISE EXCEPTION, то есть nonzero
-- exit code и красная сборка.
--
-- Почему это отдельный файл: прежняя вторая копия схемы (db/init.sql) разошлась
-- с основной и обрывалась на 42P01 (ограничение на несуществующую
-- platform_cashbox), из-за чего свежий Docker-том поднимался без половины
-- таблиц, а падало это только в рантайме.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Все таблицы на месте
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t) INTO missing
    FROM unnest(ARRAY[
      'users','transactions','withdrawals','rocket_bankroll','platform_cashbox',
      'cashbox_transfers','rocket_rounds','duels','safes','safe_deposits',
      'vault_deposits','vault_deposit_accruals','vault_pool_daily','daily_revenue',
      'settings','user_notifications','admin_audit_log','user_security_identifiers',
      'antifraud_flags'
    ]) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'В схеме нет таблиц: %', missing;
  END IF;
END $$;

-- 2. Ключевые колонки, добавленные миграциями (существующие БД добирают их в src/index.ts)
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(expected, ', ' ORDER BY expected) INTO missing
    FROM (VALUES
      ('rocket_rounds','tick_started_at'),
      ('rocket_rounds','replay_seed'),
      ('safes','crack_started_at'),
      ('safes','collect_started_at'),
      ('safes','commission_settled'),
      ('vault_deposits','unlocks_at'),
      ('vault_pool_daily','distributed_at'),
      ('duels','target_user_id'),
      ('duels','parent_duel_id'),
      ('users','banned'),
      ('users','ban_reason')
    ) AS v(tbl, col)
    CROSS JOIN LATERAL (SELECT v.tbl || '.' || v.col AS expected) e
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = v.tbl AND c.column_name = v.col
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'В схеме нет колонок: %', missing;
  END IF;
END $$;

-- 3. crash_at вмещает точку взрыва при большой кассе (DECIMAL(8,4) переполнялся: 22003)
DO $$
DECLARE
  prec int; scale int;
BEGIN
  SELECT numeric_precision, numeric_scale INTO prec, scale
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='rocket_rounds' AND column_name='crash_at';
  IF prec IS NULL OR prec < 12 OR scale <> 4 THEN
    RAISE EXCEPTION 'rocket_rounds.crash_at должен быть DECIMAL(12,4), а не DECIMAL(%,%)', prec, scale;
  END IF;
END $$;

-- 4. Частичный уникальный индекс «один активный вклад» (защита от двойной выплаты тела)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='vault_deposits_one_active'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%active%'
  ) THEN
    RAISE EXCEPTION 'Нет частичного уникального индекса vault_deposits_one_active';
  END IF;
END $$;

-- 5. CHECK-ограничения денег
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c, ', ' ORDER BY c) INTO missing
    FROM unnest(ARRAY[
      'users_balance_nonnegative','users_frozen_nonnegative','users_frozen_within_balance',
      'rocket_bankroll_nonnegative','platform_cashbox_nonnegative','safes_money_nonnegative'
    ]) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint WHERE conname = c AND contype = 'c'
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Нет CHECK-ограничений: %', missing;
  END IF;
END $$;

-- 6. Сиды настроек: экономика должна читаться из settings, а не из кода
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(k, ', ' ORDER BY k) INTO missing
    FROM unnest(ARRAY[
      'commission_percent','withdraw_commission','referral_percent','min_bet',
      'rocket_max_bet_percent','vault_pool_percent','safe_min_bank','safe_min_participants',
      'beautiful_flight_chance','vault_min_deposit','vault_max_floor','vault_max_multiplier',
      'dead_balance_inactive_days','safe_crack_hour','safe_crack_minute',
      'safe_crack_timeout_minutes','safe_drum_speed_multiplier','safe_payout_multiplier',
      'project_start_date'
    ]) AS k
   WHERE NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = k AND s.value IS NOT NULL);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'В settings нет ключей: %', missing;
  END IF;
END $$;

-- 7. Кассы инициализированы (одна строка id=1 в каждой)
DO $$
DECLARE
  cash numeric; bank numeric;
BEGIN
  SELECT amount INTO cash FROM platform_cashbox WHERE id = 1;
  SELECT amount INTO bank FROM rocket_bankroll WHERE id = 1;
  IF cash IS NULL THEN RAISE EXCEPTION 'platform_cashbox не инициализирована (нет строки id=1)'; END IF;
  IF bank IS NULL THEN RAISE EXCEPTION 'rocket_bankroll не инициализирована (нет строки id=1)'; END IF;
END $$;

-- 8. Реальная запись предельного crash_at (прежде INSERT падал с 22003)
DO $$
BEGIN
  INSERT INTO users (telegram_id, username, balance) VALUES (-999001, 'schema_check', 0);
  INSERT INTO rocket_rounds (user_id, bet, crash_at, flight_curve)
    VALUES ((SELECT id FROM users WHERE telegram_id = -999001), 1, 999999.9999, 0.075);
  DELETE FROM rocket_rounds WHERE user_id = (SELECT id FROM users WHERE telegram_id = -999001);
  DELETE FROM users WHERE telegram_id = -999001;
EXCEPTION WHEN others THEN
  RAISE EXCEPTION 'crash_at = 999999.9999 не помещается в колонку: % (SQLSTATE %)', SQLERRM, SQLSTATE;
END $$;

SELECT 'schema-check: OK' AS result;
