-- 036: Bitácora de las decisiones de «interés generado (1007)» tomadas desde el detalle de un extracto.
-- La regla en sí vive en `fs_bank_interest_rules` (banco + concepto exacto); aquí queda quién/cuándo/qué cambió y a qué extractos alcanzó.
-- Solo adiciones. Nunca se borra: una decisión posterior agrega otra fila.

CREATE TABLE IF NOT EXISTS fs_bank_interest_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL REFERENCES companies(id),
    bank         TEXT NOT NULL CHECK (trim(bank) <> ''),
    concept      TEXT NOT NULL CHECK (trim(concept) <> ''),
    decision     TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected', 'removed', 'changed')),
    previous     TEXT NOT NULL CHECK (previous IN ('confirmed', 'rejected', 'none')),
    next         TEXT NOT NULL CHECK (next IN ('confirmed', 'rejected', 'none')),
    amount_cents INTEGER NOT NULL DEFAULT 0,
    batch_ids    TEXT NOT NULL DEFAULT '[]',
    reason       TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_bank_interest_log_company ON fs_bank_interest_log (company_id, bank, concept);
