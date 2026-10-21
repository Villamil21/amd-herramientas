-- 035: Extractos bancarios ya enviados: edición por concepto con «Actualización pendiente», bitácora y meses «No aplica».
-- Solo adiciones.
--
-- 1) `fs_bank_pending_edits`: cambio guardado sobre un concepto de un extracto vigente que AÚN NO se aplicó a Estados
--    Financieros (destino, cuenta PUC y marca GMF). Existe a lo sumo uno por extracto y concepto. Aplicarlo (o descartarlo) lo borra.
--    `previous` es la foto del concepto cuando se guardó el cambio (destino, PUC, GMF y valor), para mostrar antes y después.
-- 2) `fs_bank_edit_log`: bitácora de los cambios YA aplicados (qué cambió, cuándo, valor anterior y nuevo, motivo y extracto de origen).
--    Nunca se borra: un cambio posterior agrega otra fila.
-- 3) `fs_bank_month_na`: mes sin extracto que el usuario registró explícitamente como «No aplica» (por cuenta; sin cuentas, account_number '').

CREATE TABLE IF NOT EXISTS fs_bank_pending_edits (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL REFERENCES companies(id),
    batch_id     INTEGER NOT NULL REFERENCES fs_batches(id),
    concept      TEXT NOT NULL CHECK (trim(concept) <> ''),
    destination  TEXT NOT NULL CHECK (destination IN ('send', 'skip')),
    puc_code     TEXT NOT NULL DEFAULT '',
    is_gmf       INTEGER NOT NULL DEFAULT 0 CHECK (is_gmf IN (0, 1)),
    previous     TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (batch_id, concept)
);
CREATE INDEX IF NOT EXISTS idx_fs_bank_pending_edits_company ON fs_bank_pending_edits (company_id, batch_id);

CREATE TABLE IF NOT EXISTS fs_bank_edit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id),
    batch_id    INTEGER NOT NULL REFERENCES fs_batches(id),
    concept     TEXT NOT NULL,
    reason      TEXT NOT NULL CHECK (trim(reason) <> ''),
    previous    TEXT NOT NULL,
    next        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_bank_edit_log_company ON fs_bank_edit_log (company_id, batch_id);

CREATE TABLE IF NOT EXISTS fs_bank_month_na (
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    bank_key        TEXT NOT NULL CHECK (trim(bank_key) <> ''),
    account_number  TEXT NOT NULL DEFAULT '',
    month           TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    reason          TEXT NOT NULL CHECK (trim(reason) <> ''),
    created_at      TEXT NOT NULL,
    PRIMARY KEY (company_id, bank_key, account_number, month)
);
