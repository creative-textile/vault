-- ═══════════════════════════════════════════════════════════════════════════
-- VAULT — ЕДИНСТВЕННАЯ схема БД (source of truth).
--
-- Этот файл исполняется при первом старте контейнера PostgreSQL
-- (db/Dockerfile копирует его в /docker-entrypoint-initdb.d/), а также
-- используется для проверки схемы в CI (.github/workflows/ci.yml).
--
-- Правила, которые нарушать нельзя:
--  1. Все объекты создаются ДО блока денежных ограничений: official-образ
--     запускает скрипт через `psql --set ON_ERROR_STOP=1`, поэтому любая
--     ошибка обрывает инициализацию, и всё после неё не создаётся.
--  2. Никаких ссылок на таблицы, которых ещё нет в этом файле.
--  3. Всё идемпотентно (IF NOT EXISTS / ON CONFLICT) — скрипт можно
--     прогонять повторно.
--  4. Колонки, которые добавляет backend/src/index.ts своими ALTER-миграциями
--     для уже живых БД, здесь объявлены явно: свежая БД должна получать
--     полную схему сразу, а не ждать старта бэкенда.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Пользователи ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id                SERIAL PRIMARY KEY,
    telegram_id       BIGINT UNIQUE NOT NULL,
    username          VARCHAR(64),
    balance           DECIMAL(12,2) DEFAULT 0,
    frozen_balance    DECIMAL(12,2) DEFAULT 0,
    deposit_address   VARCHAR(128),
    withdraw_address  VARCHAR(128),
    pin_hash          VARCHAR(256),
    referred_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ref_code          VARCHAR(16) UNIQUE,
    auto_safe_percent INTEGER DEFAULT 0,
    notif_duel        BOOLEAN DEFAULT TRUE,
    notif_safe        BOOLEAN DEFAULT TRUE,
    notif_referral    BOOLEAN DEFAULT TRUE,
    notif_vault       BOOLEAN DEFAULT TRUE,
    banned            BOOLEAN DEFAULT FALSE,
    ban_reason        TEXT,
    created_at        TIMESTAMP DEFAULT NOW(),
    last_active       TIMESTAMP DEFAULT NOW(),
    notified_dead     BOOLEAN DEFAULT FALSE,
    dead_deadline     TIMESTAMP
);

-- Один кошелёк вывода = один аккаунт (детекция мультиаккаунтов).
CREATE UNIQUE INDEX IF NOT EXISTS users_withdraw_address_unique
    ON users(withdraw_address) WHERE withdraw_address IS NOT NULL AND withdraw_address <> '';

-- ── Журнал всех движений денег ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type          VARCHAR(32) NOT NULL,
    amount        DECIMAL(12,2) NOT NULL,
    balance_after DECIMAL(12,2) NOT NULL,
    game_type     VARCHAR(16),
    game_id       INTEGER,
    description   TEXT,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created
    ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type_created
    ON transactions(type, created_at DESC);

-- ── Заявки на вывод ────────────────────────────────────────────────────────
-- Вывод больше не «списали и забыли»: деньги уходят с баланса и одновременно
-- создаётся заявка. В демо она сразу paid, в реальном режиме — pending, и
-- оператор отправляет её вручную (POST /api/admin/withdrawals/:id/pay) с
-- tx_hash из блокчейна. Статус меняется только из pending, поэтому двойная
-- выплата или двойной возврат одной заявки невозможны.
CREATE TABLE IF NOT EXISTS withdrawals (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount        DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    fee           DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
    payout        DECIMAL(12,2) NOT NULL CHECK (payout >= 0),
    address       TEXT NOT NULL,
    status        VARCHAR(16) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','rejected')),
    tx_hash       TEXT,
    reject_reason TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    paid_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at DESC);

-- ── Кассы проекта ──────────────────────────────────────────────────────────
-- Изолированный банк Ракеты (seed $1500 по ТЗ).
CREATE TABLE IF NOT EXISTS rocket_bankroll (
    id         SERIAL PRIMARY KEY,
    amount     DECIMAL(14,2) DEFAULT 1500,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Главная касса платформы: сюда попадает доход, из неё — ручной пул Вклада
-- и переводы в кассу Ракеты. Создаётся ДО блока ограничений (см. правило 1).
CREATE TABLE IF NOT EXISTS platform_cashbox (
    id         SERIAL PRIMARY KEY,
    amount     DECIMAL(14,2) DEFAULT 500,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cashbox_transfers (
    id          SERIAL PRIMARY KEY,
    from_source VARCHAR(32) NOT NULL, -- platform | rocket | vault | seed | external
    to_source   VARCHAR(32) NOT NULL,
    amount      DECIMAL(12,2) NOT NULL,
    note        TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- ── Ракета ─────────────────────────────────────────────────────────────────
-- crash_at: DECIMAL(12,4), а не (8,4). Точка взрыва ограничена сверху
-- отношением кассы к ставке (bankroll / bet), поэтому при кассе больше
-- $10 000 и ставке $1 значение 9999.9999 (потолок DECIMAL(8,4)) переполняло
-- колонку: INSERT падал с 22003 numeric field overflow, и игрок получал
-- ошибку вместо раунда. Сервис дополнительно клампит значение (CRASH_HARD_CAP).
CREATE TABLE IF NOT EXISTS rocket_rounds (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
    bet              DECIMAL(12,2) NOT NULL,
    crash_at         DECIMAL(12,4) NOT NULL,
    cashout_at       DECIMAL(12,4),
    profit           DECIMAL(12,2) DEFAULT 0,
    flight_curve     DECIMAL(6,4) DEFAULT 0.075,
    was_beautiful    BOOLEAN DEFAULT FALSE,
    replay_seed      VARCHAR(64),
    -- Момент, когда сервер начал тикать раунд. По нему кэшаут считается на
    -- ЛЮБОМ инстансе backend (activeRounds живёт в памяти одного процесса),
    -- а cron дорасчёта находит раунды, зависшие после рестарта.
    tick_started_at  TIMESTAMPTZ,
    started_at       TIMESTAMP DEFAULT NOW(),
    created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rocket_rounds_unsettled
    ON rocket_rounds(id) WHERE cashout_at IS NULL;

-- ── Дуэль ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS duels (
    id              SERIAL PRIMARY KEY,
    creator_id      INTEGER REFERENCES users(id),
    opponent_id     INTEGER REFERENCES users(id),
    -- Адресный реванш: принять/отклонить может только этот игрок
    target_user_id  INTEGER REFERENCES users(id),
    parent_duel_id  INTEGER REFERENCES duels(id),
    amount          DECIMAL(12,2) NOT NULL,
    status          VARCHAR(16) DEFAULT 'waiting', -- waiting/playing/finished/cancelled/declined
    result          VARCHAR(8),
    winner_id       INTEGER REFERENCES users(id),
    coin_trajectory JSONB,
    created_at      TIMESTAMP DEFAULT NOW(),
    finished_at     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_duels_waiting ON duels(status, created_at DESC);

-- ── Сейф ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS safes (
    id                 SERIAL PRIMARY KEY,
    bank               DECIMAL(12,2) DEFAULT 0,
    prize_pool         DECIMAL(12,2) DEFAULT 0,
    commission_amount  DECIMAL(12,2) DEFAULT 0,
    code               INTEGER[3],
    drum_speeds        DECIMAL(4,2)[3],
    status             VARCHAR(16) DEFAULT 'collecting', -- collecting/cracking/finished/cancelled
    bonus              BOOLEAN DEFAULT FALSE,
    participants_count INTEGER DEFAULT 0,
    winners_count      INTEGER DEFAULT 0,
    date               DATE UNIQUE DEFAULT CURRENT_DATE,
    cracked_at         TIMESTAMP,
    -- Момент старта фазы взлома: от него считаются окно взлома и время игрока
    crack_started_at   TIMESTAMPTZ,
    -- Момент начала сбора: по нему планировщик понимает, не отыгран ли
    -- сегодняшний слот взлома предыдущим сейфом
    collect_started_at TIMESTAMPTZ,
    -- Комиссия распределяется один раз, в момент старта взлома
    commission_settled BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS safe_deposits (
    id            SERIAL PRIMARY KEY,
    safe_id       INTEGER REFERENCES safes(id) ON DELETE CASCADE,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
    amount        DECIMAL(12,2) NOT NULL,
    crack_time_ms INTEGER,
    prize         DECIMAL(12,2) DEFAULT 0,
    created_at    TIMESTAMP DEFAULT NOW(),
    UNIQUE(safe_id, user_id)
);

-- ── Vault Вклад ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vault_deposits (
    id                 SERIAL PRIMARY KEY,
    user_id            INTEGER REFERENCES users(id) ON DELETE CASCADE,
    amount             DECIMAL(12,2) NOT NULL,
    term_days          INTEGER NOT NULL,
    multiplier         DECIMAL(4,2) NOT NULL,
    days_elapsed       INTEGER DEFAULT 0,
    accumulated_profit DECIMAL(12,2) DEFAULT 0,
    status             VARCHAR(16) DEFAULT 'active', -- active/completed/early_unlock
    created_at         TIMESTAMP DEFAULT NOW(),
    unlocked_at        TIMESTAMP,
    -- Полные 24 часа × срок: выплата не зависит от календарного начисления
    unlocks_at         TIMESTAMPTZ
);

-- Инвариант «один активный вклад на пользователя» обеспечивается базой,
-- а не только проверкой в сервисе (check-then-insert успевал пройти дважды).
CREATE UNIQUE INDEX IF NOT EXISTS vault_deposits_one_active
    ON vault_deposits(user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS vault_deposit_accruals (
    id          SERIAL PRIMARY KEY,
    deposit_id  INTEGER REFERENCES vault_deposits(id),
    user_id     INTEGER REFERENCES users(id),
    date        DATE NOT NULL,
    pool_amount DECIMAL(12,2) NOT NULL,
    profit      DECIMAL(12,2) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(deposit_id, date)
);

CREATE INDEX IF NOT EXISTS idx_vault_accruals_user ON vault_deposit_accruals(user_id, date DESC);

CREATE TABLE IF NOT EXISTS vault_pool_daily (
    id               SERIAL PRIMARY KEY,
    date             DATE UNIQUE NOT NULL,
    platform_revenue DECIMAL(12,2) DEFAULT 0,
    auto_pool        DECIMAL(12,2) DEFAULT 0,
    manual_pool      DECIMAL(12,2) DEFAULT 0,
    total_pool       DECIMAL(12,2) DEFAULT 0,
    total_locked     DECIMAL(12,2) DEFAULT 0,
    depositors_count INTEGER DEFAULT 0,
    base_rate        DECIMAL(6,4) DEFAULT 0,
    max_deposit      DECIMAL(12,2) DEFAULT 100,
    -- Полуночное распределение идемпотентно: отметка ставится один раз
    distributed_at   TIMESTAMPTZ
);

-- ── Доход платформы по дням и источникам ───────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_revenue (
    id         SERIAL PRIMARY KEY,
    date       DATE NOT NULL,
    source     VARCHAR(32) NOT NULL, -- rocket/duel/safe/withdrawal/safe_remainder
    amount     DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(date, source)
);

-- ── Настройки платформы (единственный источник цифр экономики) ─────────────
CREATE TABLE IF NOT EXISTS settings (
    key   VARCHAR(64) PRIMARY KEY,
    value TEXT
);

-- ── Уведомления ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_notifications (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                VARCHAR(50) NOT NULL,
    title               VARCHAR(255) NOT NULL,
    message             TEXT NOT NULL,
    data                JSONB,
    is_read             BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at          TIMESTAMP WITH TIME ZONE,
    related_entity_type VARCHAR(50),
    related_entity_id   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread
    ON user_notifications(user_id, is_read);

-- Дедупликация lifecycle-событий: cron-повторы и несколько реплик backend
-- не создают второе уведомление о том же событии.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_notification_lifecycle
    ON user_notifications(user_id, type, related_entity_type, related_entity_id);

-- ── Безопасность и администрирование ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id            BIGSERIAL PRIMARY KEY,
    actor_user_id INTEGER REFERENCES users(id),
    method        VARCHAR(12),
    path          TEXT,
    payload       JSONB,
    status_code   INTEGER,
    ip            VARCHAR(128),
    user_agent    TEXT,
    duration_ms   INTEGER,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_security_identifiers (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ip_hash     CHAR(64) NOT NULL,
    device_hash CHAR(64) NOT NULL,
    first_seen  TIMESTAMPTZ DEFAULT NOW(),
    last_seen   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, ip_hash, device_hash)
);

CREATE TABLE IF NOT EXISTS antifraud_flags (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    kind        VARCHAR(64),
    risk_score  INTEGER DEFAULT 0,
    details     JSONB,
    details_hash CHAR(64),
    status      VARCHAR(16) DEFAULT 'open',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    UNIQUE(user_id, kind, details_hash)
);

-- ── Сиды ───────────────────────────────────────────────────────────────────
INSERT INTO rocket_bankroll (id, amount) VALUES (1, 1500) ON CONFLICT (id) DO NOTHING;
INSERT INTO platform_cashbox (id, amount) VALUES (1, 500) ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (key, value) VALUES
    ('commission_percent', '10'),
    ('withdraw_commission', '1'),
    ('referral_percent', '3'),
    ('min_bet', '1'),
    ('rocket_max_bet_percent', '100'),
    ('beautiful_flight_chance', '3'),
    ('safe_min_bank', '25'),
    ('safe_min_participants', '2'),
    ('safe_crack_hour', '18'),
    ('safe_crack_minute', '0'),
    ('safe_crack_timeout_minutes', '1'),
    ('safe_drum_speed_multiplier', '1'),
    ('safe_payout_multiplier', '1.5'),
    ('vault_pool_percent', '15'),
    ('vault_min_deposit', '10'),
    ('vault_max_floor', '100'),
    ('vault_max_multiplier', '10'),
    ('dead_balance_inactive_days', '180'),
    ('manual_pool_addition', '0'),
    ('project_start_date', '2026-01-01')
ON CONFLICT (key) DO NOTHING;

-- ── Денежные инварианты ────────────────────────────────────────────────────
-- Отрицательные пользовательские средства, кассы и фонды запрещены на уровне
-- базы: это последняя граница защиты, даже если сервис ошибся.
-- Все таблицы к этому моменту уже созданы (см. правило 1 в шапке файла).
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_balance_nonnegative CHECK (balance >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_frozen_nonnegative CHECK (frozen_balance >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_frozen_within_balance CHECK (frozen_balance <= balance);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE rocket_bankroll ADD CONSTRAINT rocket_bankroll_nonnegative CHECK (amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE platform_cashbox ADD CONSTRAINT platform_cashbox_nonnegative CHECK (amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE safes ADD CONSTRAINT safes_money_nonnegative
    CHECK (bank >= 0 AND prize_pool >= 0 AND commission_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE vault_deposits ADD CONSTRAINT vault_deposits_money_nonnegative
    CHECK (amount >= 0 AND accumulated_profit >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE safe_deposits ADD CONSTRAINT safe_deposits_money_nonnegative
    CHECK (amount >= 0 AND prize >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
