-- 002: datos para certificados de composición accionaria. Solo adiciones.
ALTER TABLE companies ADD COLUMN dv TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN subscribed_total_shares INTEGER;
ALTER TABLE companies ADD COLUMN subscribed_nominal_value INTEGER;
ALTER TABLE companies ADD COLUMN paid_total_shares INTEGER;
ALTER TABLE companies ADD COLUMN paid_nominal_value INTEGER;

CREATE TABLE IF NOT EXISTS shareholders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    identity_document TEXT NOT NULL,
    percentage        REAL NOT NULL,
    sort_order        INTEGER NOT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shareholders_company_order ON shareholders(company_id, sort_order);

CREATE TABLE IF NOT EXISTS certificate_signers (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT NOT NULL,
    role                  TEXT NOT NULL,
    professional_document TEXT NOT NULL,
    signature_file        TEXT NOT NULL,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_certificate_signers_name ON certificate_signers(name COLLATE NOCASE);
