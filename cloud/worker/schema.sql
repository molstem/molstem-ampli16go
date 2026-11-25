-- molstem cloud D1 database schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                -- UUID
    email TEXT UNIQUE NOT NULL,
    google_id TEXT UNIQUE NOT NULL,
    name TEXT,
    picture_url TEXT,
    created_at INTEGER NOT NULL,        -- Unix timestamp (seconds)
    last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Devices table
CREATE TABLE IF NOT EXISTS devices (
    serial_number TEXT PRIMARY KEY,     -- MOLSTEM-{10 base32 chars}
    user_id TEXT REFERENCES users(id),  -- NULL if not enrolled
    name TEXT,                          -- User-assigned name
    cert_fingerprint TEXT,              -- SHA256 of client cert (generic cert)
    public_key TEXT,                    -- Base64-encoded SPKI public key (P-256) for per-device signing
    enrolled_at INTEGER,                -- Unix timestamp (seconds)
    last_seen_at INTEGER,               -- Unix timestamp (seconds)
    created_at INTEGER NOT NULL         -- Unix timestamp (seconds), first time device connected
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_cert_fingerprint ON devices(cert_fingerprint);
CREATE INDEX IF NOT EXISTS idx_devices_public_key ON devices(public_key);

-- Enrollment table (temporary enrollment codes, deleted once used)
CREATE TABLE IF NOT EXISTS enrollments (
    enrollment_id TEXT PRIMARY KEY,     -- XXXX-XXXX (hex format)
    serial_number TEXT UNIQUE NOT NULL, -- References devices(serial_number)
    created_at INTEGER NOT NULL,        -- Unix timestamp (seconds)
    expires_at INTEGER NOT NULL         -- Unix timestamp (seconds), 5 minutes from creation
);

CREATE INDEX IF NOT EXISTS idx_enrollments_serial ON enrollments(serial_number);
CREATE INDEX IF NOT EXISTS idx_enrollments_expires ON enrollments(expires_at);

-- Provisions table (provisioning history with attestations)
CREATE TABLE IF NOT EXISTS provisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial_number TEXT NOT NULL,            -- Device serial
    attestation_json TEXT NOT NULL,         -- Full signed attestation JSON
    attestation_hash TEXT NOT NULL,         -- SHA256 of attestation data
    signoff_json TEXT,                      -- Signed signoff JSON (NULL until approved)
    provisioned_by TEXT,                    -- Admin email who approved
    provision_mode TEXT NOT NULL,           -- 'development' or 'production'
    hw_version TEXT,                        -- Hardware version from attestation
    created_at INTEGER NOT NULL,            -- When attestation was received
    signed_off_at INTEGER                   -- When signoff was generated (NULL until approved)
);

CREATE INDEX IF NOT EXISTS idx_provisions_serial ON provisions(serial_number);
CREATE INDEX IF NOT EXISTS idx_provisions_hash ON provisions(attestation_hash);
