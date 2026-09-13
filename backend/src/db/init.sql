-- VAULT Database schema (v4)
CREATE TABLE IF NOT EXISTS users (
    id               SERIAL PRIMARY KEY,
    telegram_id      BIGINT UNIQUE NOT NULL,
    username         VARCHAR(64),
    balance          DECIMAL(12,2) DEFAULT 0,
    frozen_balance   DECIMAL(12,2) DEFAULT 0,
    deposit_address  VARCHAR(128),
    withdraw_address VARCHAR(128),
    pin_hash         VARCHAR(256),
    referred_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ref_code         VARCHAR(16) UNIQUE,
    auto_safe_percent INTEGER DEFAULT 0,
    notif_duel       BOOLEAN DEFAULT TRUE,
    notif_safe       BOOLEAN DEFAULT TRUE,
    notif_referral   BOOLEAN DEFAULT TRUE,
    notif_vault      BOOLEAN DEFAULT TRUE,
    banned           BOOLEAN DEFAULT FALSE,
    ban_reason       TEXT,
    created_at       TIMESTAMP DEFAULT NOW(),
    last_active      TIMESTAMP DEFAULT NOW(),
    notified_dead    BOOLEAN DEFAULT FALSE,
    dead_deadline    TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS rocket_rounds (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
    bet           DECIMAL(12,2) NOT NULL,
    crash_at      DECIMAL(8,4) NOT NULL,
    cashout_at    DECIMAL(8,4),
    profit        DECIMAL(12,2) DEFAULT 0,
    flight_curve  DECIMAL(6,4) DEFAULT 0.075,
    was_beautiful BOOLEAN DEFAULT FALSE,
    started_at    TIMESTAMP DEFAULT NOW(),
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rocket_bankroll (
    id         SERIAL PRIMARY KEY,
    amount     DECIMAL(12,2) DEFAULT 1500,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_cashbox (
    id         SERIAL PRIMARY KEY,
    amount     DECIMAL(14,2) DEFAULT 500,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cashbox_transfers (
    id          SERIAL PRIMARY KEY,
    from_source VARCHAR(32) NOT NULL, -- platform | rocket | vault
    to_source   VARCHAR(32) NOT NULL,
    amount      DECIMAL(12,2) NOT NULL,
    note        TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS duels (
    id              SERIAL PRIMARY KEY,
    creator_id      INTEGER REFERENCES users(id),
    opponent_id     INTEGER REFERENCES users(id),
    amount          DECIMAL(12,2) NOT NULL,
    status          VARCHAR(16) DEFAULT 'waiting',
    result          VARCHAR(8),
    winner_id       INTEGER REFERENCES users(id),
    coin_trajectory JSONB,
    created_at      TIMESTAMP DEFAULT NOW(),
    finished_at     TIMESTAMP
);

CREATE TABLE IF NOT EXISTS safes (
    id                 SERIAL PRIMARY KEY,
    bank               DECIMAL(12,2) DEFAULT 0,
    prize_pool         DECIMAL(12,2) DEFAULT 0,
    commission_amount  DECIMAL(12,2) DEFAULT 0,
    code               INTEGER[3],
    drum_speeds        DECIMAL(4,2)[3],
    status             VARCHAR(16) DEFAULT 'collecting',
    bonus              BOOLEAN DEFAULT FALSE,
    participants_count INTEGER DEFAULT 0,
    winners_count      INTEGER DEFAULT 0,
    date               DATE UNIQUE DEFAULT CURRENT_DATE,
    cracked_at         TIMESTAMP
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

CREATE TABLE IF NOT EXISTS vault_deposits (
    id                 SERIAL PRIMARY KEY,
    user_id            INTEGER REFERENCES users(id) ON DELETE CASCADE,
    amount             DECIMAL(12,2) NOT NULL,
    term_days          INTEGER NOT NULL,
    multiplier         DECIMAL(4,2) NOT NULL,
    days_elapsed       INTEGER DEFAULT 0,
    accumulated_profit DECIMAL(12,2) DEFAULT 0,
    status             VARCHAR(16) DEFAULT 'active',
    created_at         TIMESTAMP DEFAULT NOW(),
    unlocked_at        TIMESTAMP,
    unlocks_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vault_deposit_accruals (
    id SERIAL PRIMARY KEY, deposit_id INTEGER REFERENCES vault_deposits(id),
    user_id INTEGER REFERENCES users(id), date DATE NOT NULL,
    pool_amount DECIMAL(12,2) NOT NULL, profit DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(deposit_id,date)
);

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
    distributed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS daily_revenue (
    id        SERIAL PRIMARY KEY,
    date      DATE NOT NULL,
    source    VARCHAR(32) NOT NULL,
    amount    DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(date, source)
);

CREATE TABLE IF NOT EXISTS settings (
    key   VARCHAR(64) PRIMARY KEY,
    value TEXT
);

-- Seed rocket bankroll ($1500 seed) and main platform cashbox ($500 seed)
INSERT INTO rocket_bankroll (amount) VALUES (1500) ON CONFLICT DO NOTHING;
INSERT INTO platform_cashbox (amount) VALUES (500) ON CONFLICT DO NOTHING;

-- Seed settings
INSERT INTO settings (key, value) VALUES
    ('commission_percent', '10'),
    ('withdraw_commission', '1'),
    ('referral_percent', '3'),
    ('min_bet', '1'),
    ('rocket_max_bet_percent', '50'),
    ('safe_min_bank', '25'),
    ('safe_min_participants', '2'),
    ('safe_crack_hour', '21'),
    ('safe_crack_minute', '0'),
    ('safe_drum_speed_multiplier', '1'),
    ('beautiful_flight_chance', '3'),
    ('vault_pool_percent', '15'),
    ('vault_min_deposit', '10'),
    ('vault_max_floor', '100'),
    ('vault_max_multiplier', '10'),
    ('project_start_date', '2026-01-01'),
    ('manual_pool_addition', '0')
ON CONFLICT (key) DO NOTHING;


-- Денежные инварианты: отрицательные пользовательские средства, кассы и пулы запрещены.
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
  ALTER TABLE safes ADD CONSTRAINT safes_money_nonnegative CHECK (bank >= 0 AND prize_pool >= 0 AND commission_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY, actor_user_id INTEGER REFERENCES users(id), method VARCHAR(12), path TEXT,
  payload JSONB, status_code INTEGER, ip VARCHAR(128), user_agent TEXT, duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_security_identifiers (
  id BIGSERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ip_hash CHAR(64) NOT NULL, device_hash CHAR(64) NOT NULL, first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id,ip_hash,device_hash)
);
CREATE TABLE IF NOT EXISTS antifraud_flags (
  id BIGSERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, kind VARCHAR(64),
  risk_score INTEGER DEFAULT 0, details JSONB, details_hash CHAR(64), status VARCHAR(16) DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(), reviewed_at TIMESTAMPTZ,
  UNIQUE(user_id,kind,details_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_withdraw_address_unique
  ON users(withdraw_address) WHERE withdraw_address IS NOT NULL AND withdraw_address <> '';
