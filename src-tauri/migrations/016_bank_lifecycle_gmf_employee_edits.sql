-- 016: Estados Financieros — ciclo de vida de cuentas bancarias, GMF (4x1000)
-- y edición auditable de la ficha de empleados. Solo adiciones.

-- ---------------------------------------------------------------------------
-- 1. Ciclo de vida de cuentas bancarias (empresa + banco + número de cuenta)
-- ---------------------------------------------------------------------------

-- Periodos AAAA-MM. Sin apertura conocida = se espera desde el inicio del rango;
-- sin cierre = se sigue esperando. Un saldo en 0 nunca abre ni cierra una cuenta
-- por sí solo: lo confirma el usuario.
CREATE TABLE IF NOT EXISTS fs_bank_account_lifecycle (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id      INTEGER NOT NULL REFERENCES companies(id),
    bank            TEXT NOT NULL,
    account_number  TEXT NOT NULL,
    opened_period   TEXT CHECK (opened_period IS NULL OR opened_period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    closed_period   TEXT CHECK (closed_period IS NULL OR closed_period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (company_id, bank, account_number),
    CHECK (opened_period IS NULL OR closed_period IS NULL OR opened_period <= closed_period),
    CHECK ((status = 'closed') = (closed_period IS NOT NULL))
);

-- Auditoría: cada confirmación o edición, también las respuestas «No» (sigue
-- activa / ya existía), para no volver a preguntar por el mismo extracto.
--   action: opened | closed | kept_active | existed_before | edited
--   previous: JSON {openedPeriod, closedPeriod} antes del cambio.
CREATE TABLE IF NOT EXISTS fs_bank_account_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id      INTEGER NOT NULL REFERENCES companies(id),
    bank            TEXT NOT NULL,
    account_number  TEXT NOT NULL,
    action          TEXT NOT NULL CHECK (action IN ('opened', 'closed', 'kept_active', 'existed_before', 'edited')),
    period          TEXT,
    note            TEXT NOT NULL DEFAULT '',
    previous        TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_bank_account_events ON fs_bank_account_events (company_id, bank, account_number);

-- ---------------------------------------------------------------------------
-- 2. GMF / 4x1000: banco + concepto exacto → es o no es GMF
-- ---------------------------------------------------------------------------

-- Global (como fs_bank_concept_mappings). Una detección por palabra clave sin
-- regla guardada es solo una sugerencia; «Quitar GMF» se guarda (is_gmf = 0)
-- para no volver a insistir.
--   origin: auto (detectado por palabra clave) | manual (marcado por el usuario).
CREATE TABLE IF NOT EXISTS fs_bank_gmf_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bank        TEXT NOT NULL,
    concept     TEXT NOT NULL,
    is_gmf      INTEGER NOT NULL CHECK (is_gmf IN (0, 1)),
    origin      TEXT NOT NULL CHECK (origin IN ('auto', 'manual')),
    confirmed   INTEGER NOT NULL DEFAULT 1 CHECK (confirmed IN (0, 1)),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (bank, concept)
);

-- ---------------------------------------------------------------------------
-- 3. Ficha de empleado: historial de ediciones
-- ---------------------------------------------------------------------------

-- previous / next: JSON con los campos editados. El área nunca se reescribe:
-- un cambio agrega una vigencia en fs_employee_areas.
CREATE TABLE IF NOT EXISTS fs_employee_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id  INTEGER NOT NULL REFERENCES fs_employees(id),
    action       TEXT NOT NULL,
    previous     TEXT NOT NULL DEFAULT '{}',
    next         TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_employee_events ON fs_employee_events (employee_id);
