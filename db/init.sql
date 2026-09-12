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
    unlocked_at        TIMESTAMP
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
    max_deposit      DECIMAL(12,2) DEFAULT 100
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

CREATE TABLE IF NOT EXISTS user_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    related_entity_type VARCHAR(50),
    related_entity_id INTEGER
);

-- Seed rocket bankroll ($1500 seed)
INSERT INTO rocket_bankroll (amount) VALUES (1500) ON CONFLICT DO NOTHING;

-- Seed settings
INSERT INTO settings (key, value) VALUES
    ('commission_percent', '10'),
    ('withdraw_commission', '1'),
    ('referral_percent', '3'),
    ('rocket_max_bet_percent', '50'),
    ('safe_min_bank', '25'),
    ('safe_min_participants', '3'),
    ('beautiful_flight_chance', '3'),
    ('vault_pool_percent', '15'),
    ('vault_max_deposit', '100'),
    ('manual_pool_addition', '0')
ON CONFLICT (key) DO NOTHING;
