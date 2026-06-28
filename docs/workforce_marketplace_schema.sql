-- ============================================================
-- WORKFORCE MARKETPLACE PLATFORM — PostgreSQL Schema
-- Bangladesh | MVP-First | Clean & Scalable
-- PostgreSQL 16+ | UUID PKs | Soft Delete | Audit Fields
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";       -- For geo/map features
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- For fuzzy text search

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE gender_enum AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

CREATE TYPE verification_status_enum AS ENUM ('unverified', 'pending', 'verified', 'rejected');

CREATE TYPE otp_purpose_enum AS ENUM ('login', 'register', 'reset', 'verify_phone');

CREATE TYPE session_status_enum AS ENUM ('active', 'expired', 'revoked');

CREATE TYPE shift_status_enum AS ENUM (
    'draft', 'pending_approval', 'published', 'applications_open',
    'worker_selected', 'worker_confirmed', 'worker_arriving',
    'checked_in', 'active', 'completed',
    'payment_pending', 'paid', 'closed', 'cancelled'
);

CREATE TYPE shift_type_enum AS ENUM ('instant', 'scheduled', 'prebooked');

-- Per-shift escrow state on the business wallet:
--   none → never funded (draft) | held → cost reserved (awaiting work)
--   released → settled (paid out) | refunded → returned (cancelled/rejected)
CREATE TYPE escrow_status_enum AS ENUM ('none', 'held', 'released', 'refunded');

CREATE TYPE application_status_enum AS ENUM (
    'pending', 'shortlisted', 'accepted', 'rejected', 'withdrawn', 'no_show'
);

CREATE TYPE checkin_method_enum AS ENUM ('manual', 'gps', 'qr', 'pin');

CREATE TYPE payment_status_enum AS ENUM ('pending', 'approved', 'sent', 'received', 'failed');

CREATE TYPE payment_method_enum AS ENUM ('bkash', 'nagad', 'bank_transfer', 'cash');

CREATE TYPE transaction_type_enum AS ENUM ('credit', 'debit');

CREATE TYPE notification_type_enum AS ENUM ('push', 'sms', 'in_app');

CREATE TYPE notification_priority_enum AS ENUM ('low', 'normal', 'high', 'urgent');

CREATE TYPE report_type_enum AS ENUM (
    'unsafe_environment', 'abuse', 'harassment', 'unpaid_work',
    'no_show', 'misconduct', 'bad_behavior', 'other'
);

CREATE TYPE report_status_enum AS ENUM ('open', 'under_review', 'resolved', 'dismissed');

CREATE TYPE incident_severity_enum AS ENUM ('low', 'medium', 'high', 'critical');

-- ============================================================
-- AUDIT FIELDS HELPER (applied on every table manually)
-- Standard columns added to every table:
--   created_at, updated_at, deleted_at, created_by, updated_by
-- ============================================================


-- ============================================================
-- DOMAIN 1: AUTHENTICATION & USERS
-- ============================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Identity
    phone           VARCHAR(15) NOT NULL UNIQUE,   -- Primary login: +880XXXXXXXXXX
    email           VARCHAR(255) UNIQUE,            -- Optional
    full_name       VARCHAR(100),
    profile_picture TEXT,                           -- URL to object storage

    -- Roles (array — one account can be worker + business)
    roles           TEXT[] NOT NULL DEFAULT '{}',   -- e.g. ['worker'], ['business'], ['worker','business'], ['admin']

    -- Status
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_phone_verified BOOLEAN NOT NULL DEFAULT FALSE,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    created_by      UUID,
    updated_by      UUID
);

-- OTP Requests
CREATE TABLE otp_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone           VARCHAR(15) NOT NULL,
    otp_code        VARCHAR(64) NOT NULL,          -- SHA-256 hex digest of OTP (hashed at rest)
    purpose         otp_purpose_enum NOT NULL DEFAULT 'login',
    is_used         BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ NOT NULL,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    created_by      UUID,
    updated_by      UUID
);

-- Sessions (JWT or token-based)
CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token    TEXT NOT NULL UNIQUE,
    status          session_status_enum NOT NULL DEFAULT 'active',
    active_role     VARCHAR(20),                -- worker/business context this session is in
    expires_at      TIMESTAMPTZ NOT NULL,
    ip_address      INET,
    user_agent      TEXT,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    created_by      UUID,
    updated_by      UUID
);

-- Refresh Tokens
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,
    is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ NOT NULL,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    created_by      UUID,
    updated_by      UUID
);

-- Device Tracking (for push notifications + fraud detection)
CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token    TEXT,                           -- FCM / APNs push token
    platform        VARCHAR(10),                    -- 'android', 'ios', 'web'
    device_model    VARCHAR(100),
    app_version     VARCHAR(20),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    created_by      UUID,
    updated_by      UUID
);


-- ============================================================
-- DOMAIN 2: LOCATION SYSTEM
-- ============================================================

-- Cities / Areas
CREATE TABLE cities (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL UNIQUE,       -- e.g. "Dhaka", "Chittagong"
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    created_by  UUID,
    updated_by  UUID
);

-- Zones (neighbourhoods within cities)
CREATE TABLE zones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    city_id         UUID NOT NULL REFERENCES cities(id),
    name            VARCHAR(100) NOT NULL,           -- e.g. "Banani", "Gulshan"
    coordinates     GEOGRAPHY(POINT, 4326),          -- PostGIS point (center)
    boundary        GEOGRAPHY(POLYGON, 4326),        -- PostGIS polygon (future geo-search)
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    created_by      UUID,
    updated_by      UUID,

    UNIQUE (city_id, name)
);


-- ============================================================
-- DOMAIN 3: WORK CATEGORIES & SKILLS
-- ============================================================

-- Categories (e.g. Restaurant Staff, Event Staff, Medical Assistant)
CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL UNIQUE,
    icon_url    TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    created_by  UUID,
    updated_by  UUID
);

-- Skills (fine-grained — e.g. "Food Handling", "Cash Register")
CREATE TABLE skills (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL UNIQUE,
    category_id UUID REFERENCES categories(id),     -- optional grouping
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    created_by  UUID,
    updated_by  UUID
);


-- ============================================================
-- DOMAIN 4: WORKER PROFILE
-- ============================================================

CREATE TABLE worker_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    -- Personal
    full_name           VARCHAR(100) NOT NULL,
    gender              gender_enum,
    date_of_birth       DATE,
    city_id             UUID REFERENCES cities(id),
    travel_radius_km    SMALLINT DEFAULT 10,        -- How far they'll travel

    -- Availability
    availability_days   TEXT[],                     -- ['monday','tuesday','friday']
    availability_slots  TEXT[],                     -- ['morning','afternoon','night']

    -- Verification docs (URLs to object storage)
    nid_front_url       TEXT,
    nid_back_url        TEXT,
    selfie_url          TEXT,
    student_id_url      TEXT,                       -- Optional

    -- Verification
    verification_status verification_status_enum NOT NULL DEFAULT 'unverified',
    verification_note   TEXT,                       -- Admin note on rejection

    -- Trust metrics (updated by background jobs)
    reliability_score   NUMERIC(4,2) DEFAULT 0,     -- 0–100
    attendance_rate     NUMERIC(5,2) DEFAULT 0,     -- percentage
    completion_rate     NUMERIC(5,2) DEFAULT 0,     -- percentage
    response_rate       NUMERIC(5,2) DEFAULT 0,     -- percentage
    no_show_count       INT NOT NULL DEFAULT 0,
    completed_shift_count INT NOT NULL DEFAULT 0,

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    created_by          UUID,
    updated_by          UUID
);

-- Worker ↔ Skills (many-to-many)
CREATE TABLE worker_skills (
    worker_profile_id   UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    skill_id            UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (worker_profile_id, skill_id)
);

-- Worker ↔ Preferred Categories (many-to-many)
CREATE TABLE worker_categories (
    worker_profile_id   UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    category_id         UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (worker_profile_id, category_id)
);

-- Worker ↔ Preferred Zones (many-to-many)
CREATE TABLE worker_preferred_zones (
    worker_profile_id   UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    zone_id             UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    PRIMARY KEY (worker_profile_id, zone_id)
);


-- ============================================================
-- DOMAIN 5: BUSINESS PROFILE
-- ============================================================

CREATE TABLE business_profiles (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    -- Business info
    business_name           VARCHAR(200) NOT NULL,
    business_type           VARCHAR(100),               -- 'restaurant', 'hospital', 'retail', etc.
    logo_url                TEXT,

    -- Manager contact
    manager_name            VARCHAR(100),
    manager_phone           VARCHAR(15),

    -- Primary location (MVP — branches come later)
    address                 TEXT,
    landmark                TEXT,
    coordinates             GEOGRAPHY(POINT, 4326),     -- PostGIS
    zone_id                 UUID REFERENCES zones(id),

    -- Verification
    trade_license_url       TEXT,
    business_doc_url        TEXT,
    verification_status     verification_status_enum NOT NULL DEFAULT 'unverified',
    verification_note       TEXT,

    -- Preferences
    meal_included           BOOLEAN NOT NULL DEFAULT FALSE,
    transport_support       BOOLEAN NOT NULL DEFAULT FALSE,
    female_friendly         BOOLEAN NOT NULL DEFAULT FALSE,
    uniform_required        BOOLEAN NOT NULL DEFAULT FALSE,

    -- Trust metrics (updated by background jobs)
    reliability_score       NUMERIC(4,2) DEFAULT 0,
    cancellation_rate       NUMERIC(5,2) DEFAULT 0,
    payment_reliability     NUMERIC(5,2) DEFAULT 0,
    dispute_count           INT NOT NULL DEFAULT 0,

    -- Audit
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at              TIMESTAMPTZ,
    created_by              UUID,
    updated_by              UUID
);

-- Future: Business Branches (stub — not active in MVP)
-- Just add branch_id FK to shifts when needed.
CREATE TABLE business_branches (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
    branch_name         VARCHAR(200) NOT NULL,
    address             TEXT,
    landmark            TEXT,
    coordinates         GEOGRAPHY(POINT, 4326),
    zone_id             UUID REFERENCES zones(id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    created_by          UUID,
    updated_by          UUID
);


-- ============================================================
-- DOMAIN 6: SHIFTS
-- ============================================================

CREATE TABLE shifts (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_profile_id     UUID NOT NULL REFERENCES business_profiles(id),

    -- Optional: which branch (MVP can be NULL)
    branch_id               UUID REFERENCES business_branches(id),

    -- Basic info
    title                   VARCHAR(200) NOT NULL,
    description             TEXT,
    category_id             UUID NOT NULL REFERENCES categories(id),
    role_type               VARCHAR(100),               -- e.g. "Waiter", "Event Helper"
    shift_type              shift_type_enum NOT NULL DEFAULT 'scheduled',

    -- Scheduling
    shift_date              DATE NOT NULL,
    start_time              TIME NOT NULL,
    end_time                TIME NOT NULL,

    -- Compensation
    pay_amount              NUMERIC(10,2) NOT NULL,
    currency                VARCHAR(3) NOT NULL DEFAULT 'BDT',

    -- Staffing
    workers_needed          SMALLINT NOT NULL DEFAULT 1,
    gender_preference       gender_enum,                -- NULL = any gender

    -- Benefits
    meal_included           BOOLEAN NOT NULL DEFAULT FALSE,
    transport_support       BOOLEAN NOT NULL DEFAULT FALSE,

    -- Location (can differ from business address)
    address                 TEXT,
    landmark                TEXT,
    coordinates             GEOGRAPHY(POINT, 4326),
    zone_id                 UUID REFERENCES zones(id),

    -- Live-attendance check-in: secret token the business displays on-site for
    -- workers to scan (QR check-in). Stable per shift, set at creation.
    checkin_qr_token        UUID NOT NULL DEFAULT uuid_generate_v4(),

    -- Status lifecycle
    status                  shift_status_enum NOT NULL DEFAULT 'draft',

    -- Cancellation reason (if cancelled)
    cancellation_reason     TEXT,

    -- Escrow: full estimated cost (pay_amount × workers_needed) reserved from the
    -- business wallet when the shift is submitted for review, released at settlement.
    escrow_amount           NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    escrow_status           escrow_status_enum NOT NULL DEFAULT 'none',

    -- Audit
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at              TIMESTAMPTZ,
    created_by              UUID,
    updated_by              UUID
);


-- ============================================================
-- DOMAIN 7: APPLICATIONS & ASSIGNMENTS
-- ============================================================

-- Worker applies to a shift
CREATE TABLE applications (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id            UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    worker_profile_id   UUID NOT NULL REFERENCES worker_profiles(id),
    status              application_status_enum NOT NULL DEFAULT 'pending',
    applied_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note                TEXT,                           -- Worker's optional note

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    created_by          UUID,
    updated_by          UUID,

    UNIQUE (shift_id, worker_profile_id)
);

-- Confirmed worker assignments (selected + confirmed workers for a shift)
CREATE TABLE worker_assignments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id            UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    application_id      UUID NOT NULL REFERENCES applications(id),
    worker_profile_id   UUID NOT NULL REFERENCES worker_profiles(id),

    -- Check-in
    checkin_method      checkin_method_enum,
    checked_in_at       TIMESTAMPTZ,
    checked_out_at      TIMESTAMPTZ,

    -- Payment status for this assignment
    payment_status      payment_status_enum NOT NULL DEFAULT 'pending',

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    created_by          UUID,
    updated_by          UUID,

    UNIQUE (shift_id, worker_profile_id)
);

-- Business favorites a worker (for repeat hiring)
CREATE TABLE business_favorite_workers (
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
    worker_profile_id   UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_profile_id, worker_profile_id)
);


-- ============================================================
-- DOMAIN 8: RATINGS
-- ============================================================

-- Worker rated by business, or business rated by worker
CREATE TABLE ratings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id            UUID NOT NULL REFERENCES shifts(id),
    assignment_id       UUID REFERENCES worker_assignments(id),

    -- Who rated whom
    rater_user_id       UUID NOT NULL REFERENCES users(id),
    rated_user_id       UUID NOT NULL REFERENCES users(id),

    -- Score
    overall_score       SMALLINT NOT NULL CHECK (overall_score BETWEEN 1 AND 5),

    -- Category scores (optional breakdown)
    punctuality_score   SMALLINT CHECK (punctuality_score BETWEEN 1 AND 5),
    behavior_score      SMALLINT CHECK (behavior_score BETWEEN 1 AND 5),
    skill_score         SMALLINT CHECK (skill_score BETWEEN 1 AND 5),

    review              TEXT,
    is_anonymous        BOOLEAN NOT NULL DEFAULT FALSE,

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    created_by          UUID,
    updated_by          UUID,

    -- One rating per direction per shift
    UNIQUE (shift_id, rater_user_id, rated_user_id)
);


-- ============================================================
-- DOMAIN 9: TRUST & SAFETY
-- ============================================================

-- Reports submitted by workers or businesses
CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id        UUID REFERENCES shifts(id),
    reporter_id     UUID NOT NULL REFERENCES users(id),
    reported_id     UUID NOT NULL REFERENCES users(id),
    report_type     report_type_enum NOT NULL,
    description     TEXT,
    evidence_urls   TEXT[],                             -- Photos, screenshots
    status          report_status_enum NOT NULL DEFAULT 'open',
    resolved_by     UUID REFERENCES users(id),
    resolved_note   TEXT,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    created_by      UUID,
    updated_by      UUID
);

-- Disputes (payment or work disputes — escalated reports)
CREATE TABLE disputes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID REFERENCES reports(id),
    shift_id        UUID REFERENCES shifts(id),
    raised_by       UUID NOT NULL REFERENCES users(id),
    against_user    UUID NOT NULL REFERENCES users(id),
    description     TEXT,
    status          report_status_enum NOT NULL DEFAULT 'open',
    resolved_by     UUID REFERENCES users(id),
    resolution_note TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    created_by      UUID,
    updated_by      UUID
);

-- Warnings & Suspensions issued by admin
CREATE TABLE user_sanctions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id),
    sanction_type   VARCHAR(20) NOT NULL CHECK (sanction_type IN ('warning', 'suspension', 'ban')),
    reason          TEXT NOT NULL,
    severity        incident_severity_enum NOT NULL DEFAULT 'low',
    issued_by       UUID NOT NULL REFERENCES users(id),
    expires_at      TIMESTAMPTZ,                        -- NULL = permanent
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    created_by      UUID,
    updated_by      UUID
);


-- ============================================================
-- DOMAIN 10: PAYMENT SYSTEM
-- ============================================================

-- Worker wallet (one per worker)
CREATE TABLE wallets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id),
    balance             NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_earned        NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_withdrawn     NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    currency            VARCHAR(3) NOT NULL DEFAULT 'BDT',

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    created_by          UUID,
    updated_by          UUID
);

-- Business wallet (one per business) — funds shift escrow.
-- balance = spendable, held = currently escrowed across active shifts,
-- total_spent = lifetime paid out to workers. Seeded with a starting balance
-- (placeholder until MFS corporate top-up exists).
CREATE TABLE business_wallets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_profile_id UUID NOT NULL UNIQUE REFERENCES business_profiles(id) ON DELETE CASCADE,
    balance             NUMERIC(12,2) NOT NULL DEFAULT 500.00,
    held                NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_spent         NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    currency            VARCHAR(3) NOT NULL DEFAULT 'BDT',

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    created_by          UUID,
    updated_by          UUID
);

CREATE INDEX idx_business_wallets_profile ON business_wallets(business_profile_id);

-- All money movements (ledger)
CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id           UUID NOT NULL REFERENCES wallets(id),
    shift_id            UUID REFERENCES shifts(id),
    assignment_id       UUID REFERENCES worker_assignments(id),
    type                transaction_type_enum NOT NULL,
    amount              NUMERIC(10,2) NOT NULL,
    balance_after       NUMERIC(12,2) NOT NULL,
    description         TEXT,
    reference_id        VARCHAR(100),                   -- External payment ref

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    created_by          UUID,
    updated_by          UUID
);

-- Payout Requests (worker requests withdrawal)
CREATE TABLE payout_requests (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id           UUID NOT NULL REFERENCES wallets(id),
    user_id             UUID NOT NULL REFERENCES users(id),
    amount              NUMERIC(10,2) NOT NULL,
    method              payment_method_enum NOT NULL,
    account_number      VARCHAR(20) NOT NULL,           -- bKash/Nagad number or bank account
    account_name        VARCHAR(100),
    status              payment_status_enum NOT NULL DEFAULT 'pending',
    processed_by        UUID REFERENCES users(id),      -- Admin who approved
    processed_at        TIMESTAMPTZ,
    failure_reason      TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    created_by          UUID,
    updated_by          UUID
);


-- ============================================================
-- DOMAIN 11: NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            notification_type_enum NOT NULL,
    priority        notification_priority_enum NOT NULL DEFAULT 'normal',
    title           VARCHAR(200) NOT NULL,
    body            TEXT NOT NULL,
    data            JSONB,                              -- Extra payload (shift_id, etc.)
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    failed_at       TIMESTAMPTZ,
    failure_reason  TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    created_by      UUID,
    updated_by      UUID
);


-- ============================================================
-- DOMAIN 12: CHAT
-- ============================================================
-- Worker <-> business messaging, scoped per shift. A conversation is keyed by
-- (shift_id, worker_profile_id); the business side is derived from the shift.
-- A conversation may only be opened once an application exists for that pair.

CREATE TABLE chat_conversations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id            UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    worker_profile_id   UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
    last_message_at     TIMESTAMPTZ,                     -- inbox sort key
    last_message_text   TEXT,                            -- preview snippet
    last_sender_role    VARCHAR(10),                     -- 'worker' | 'business'

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    created_by          UUID,
    updated_by          UUID,

    UNIQUE (shift_id, worker_profile_id)
);

CREATE INDEX idx_chat_conversations_worker ON chat_conversations(worker_profile_id);
CREATE INDEX idx_chat_conversations_business ON chat_conversations(business_profile_id);
CREATE INDEX idx_chat_conversations_shift ON chat_conversations(shift_id);
CREATE INDEX idx_chat_conversations_last_msg ON chat_conversations(last_message_at DESC);

CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
    sender_role     VARCHAR(10) NOT NULL,                -- 'worker' | 'business'
    body            TEXT NOT NULL,
    read_at         TIMESTAMPTZ,                         -- set when the recipient reads it

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX idx_chat_messages_unread ON chat_messages(conversation_id, sender_role, read_at);


-- ============================================================
-- INDEXES
-- ============================================================

-- Users
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_roles ON users USING GIN(roles);
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NULL;

-- OTP
CREATE INDEX idx_otp_phone_purpose ON otp_requests(phone, purpose);
CREATE INDEX idx_otp_expires_at ON otp_requests(expires_at);

-- Sessions / Tokens
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_devices_user_id ON devices(user_id);

-- Zones (PostGIS spatial index)
CREATE INDEX idx_zones_coordinates ON zones USING GIST(coordinates);
CREATE INDEX idx_zones_boundary ON zones USING GIST(boundary);

-- Worker profiles
CREATE INDEX idx_worker_profiles_user_id ON worker_profiles(user_id);
CREATE INDEX idx_worker_profiles_city_id ON worker_profiles(city_id);
CREATE INDEX idx_worker_profiles_verification ON worker_profiles(verification_status);

-- Business profiles
CREATE INDEX idx_business_profiles_user_id ON business_profiles(user_id);
CREATE INDEX idx_business_profiles_zone ON business_profiles(zone_id);
CREATE INDEX idx_business_coordinates ON business_profiles USING GIST(coordinates);

-- Shifts (most queried table)
CREATE INDEX idx_shifts_business ON shifts(business_profile_id);
CREATE INDEX idx_shifts_category ON shifts(category_id);
CREATE INDEX idx_shifts_zone ON shifts(zone_id);
CREATE INDEX idx_shifts_status ON shifts(status);
CREATE INDEX idx_shifts_date ON shifts(shift_date);
CREATE INDEX idx_shifts_status_date ON shifts(status, shift_date);
CREATE INDEX idx_shifts_coordinates ON shifts USING GIST(coordinates);
CREATE INDEX idx_shifts_deleted_at ON shifts(deleted_at) WHERE deleted_at IS NULL;

-- Applications
CREATE INDEX idx_applications_shift ON applications(shift_id);
CREATE INDEX idx_applications_worker ON applications(worker_profile_id);
CREATE INDEX idx_applications_status ON applications(status);

-- Worker assignments
CREATE INDEX idx_assignments_shift ON worker_assignments(shift_id);
CREATE INDEX idx_assignments_worker ON worker_assignments(worker_profile_id);

-- Ratings
CREATE INDEX idx_ratings_rated_user ON ratings(rated_user_id);
CREATE INDEX idx_ratings_shift ON ratings(shift_id);

-- Transactions
CREATE INDEX idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX idx_transactions_shift ON transactions(shift_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);

-- Payout requests
CREATE INDEX idx_payout_requests_user ON payout_requests(user_id);
CREATE INDEX idx_payout_requests_status ON payout_requests(status);

-- Notifications
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- Reports
CREATE INDEX idx_reports_reporter ON reports(reporter_id);
CREATE INDEX idx_reports_reported ON reports(reported_id);
CREATE INDEX idx_reports_status ON reports(status);

-- Sanctions
CREATE INDEX idx_sanctions_user ON user_sanctions(user_id);
CREATE INDEX idx_sanctions_active ON user_sanctions(user_id, is_active) WHERE is_active = TRUE;


-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'users', 'otp_requests', 'sessions', 'refresh_tokens', 'devices',
        'cities', 'zones', 'categories', 'skills',
        'worker_profiles', 'business_profiles', 'business_branches',
        'shifts', 'applications', 'worker_assignments',
        'ratings', 'reports', 'disputes', 'user_sanctions',
        'wallets', 'business_wallets', 'transactions', 'payout_requests',
        'notifications'
    ])
    LOOP
        EXECUTE format('
            CREATE TRIGGER trg_%s_updated_at
            BEFORE UPDATE ON %s
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        ', t, t);
    END LOOP;
END;
$$;


-- ============================================================
-- SEED DATA: Dhaka Zones (MVP)
-- ============================================================

INSERT INTO cities (id, name) VALUES (uuid_generate_v4(), 'Dhaka');

-- Zones will be inserted after city ID is known via application seed scripts.
-- Example zones: Banani, Gulshan, Dhanmondi, Baridhara, Bashundhara, DOHS, Mirpur, Uttara

-- ============================================================
-- SEED DATA: Categories (MVP)
-- ============================================================

INSERT INTO categories (id, name) VALUES
    (uuid_generate_v4(), 'Medical Assistant'),
    (uuid_generate_v4(), 'Restaurant Staff'),
    (uuid_generate_v4(), 'Waiter'),
    (uuid_generate_v4(), 'Food Runner'),
    (uuid_generate_v4(), 'Event Staff'),
    (uuid_generate_v4(), 'Event Helper'),
    (uuid_generate_v4(), 'Retail Promoter'),
    (uuid_generate_v4(), 'Brand Activation Crew'),
    (uuid_generate_v4(), 'Production Assistant'),
    (uuid_generate_v4(), 'Cleaning Support'),
    (uuid_generate_v4(), 'Corporate Support');


-- ============================================================
-- NOTES FOR THE ENGINEERING TEAM
-- ============================================================

-- SOFT DELETE STRATEGY:
--   All tables have deleted_at (TIMESTAMPTZ).
--   Deleted rows have deleted_at IS NOT NULL.
--   Always filter WHERE deleted_at IS NULL in queries.
--   Unique constraints on active rows only → use partial unique indexes where needed.

-- RELIABILITY SCORE MODEL (background job, run nightly):
--   Worker score = (
--     (completion_rate * 0.35) +
--     (attendance_rate * 0.30) +
--     (response_rate  * 0.20) +
--     (avg rating     * 0.15)
--   ) mapped to 0–100
--   Penalize: no_show_count (–5 per incident, floor 0)

-- MULTI-ROLE:
--   users.roles TEXT[] handles ['worker'], ['business'], ['worker','business'], ['admin']
--   Check role in application layer before accessing worker_profiles or business_profiles.

-- MICROSERVICE SPLIT (future):
--   auth_service       → users, otp_requests, sessions, refresh_tokens, devices
--   profile_service    → worker_profiles, business_profiles, business_branches
--   shift_service      → shifts, applications, worker_assignments
--   rating_service     → ratings
--   payment_service    → wallets, transactions, payout_requests
--   trust_service      → reports, disputes, user_sanctions
--   notification_svc   → notifications
--   location_service   → cities, zones, categories, skills

-- POSTGIS USAGE:
--   Use ST_DWithin(coordinates, ST_MakePoint(lng, lat)::geography, radius_meters)
--   to find shifts or workers within a radius. Requires GIST index (already created).

-- ESCROW MODEL (implemented):
--   business_wallets funds shift escrow. On submit-for-review the shift's full
--   cost (pay_amount × workers_needed) moves balance → held + shifts.escrow_status='held'.
--   Cancel/reject → held back to balance ('refunded'). Settlement pays attended
--   workers from held, returns the unspent remainder to balance ('released').

-- FUTURE FEATURES (not in MVP, easy to add):
--   - Business wallet top-up via MFS corporate checkout (bKash/Nagad B2B)
--   - Hourly billing (rate/hour, break, platform fee) replacing flat pay_amount
--   - QR/PIN check-in: already supported via checkin_method enum
--   - Branch-level hiring: set branch_id on shifts
--   - Worker badges: add worker_badges table
--   - Shift templates: add shift_templates table referencing shifts

