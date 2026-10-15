-- 015: Estados Financieros → Obligaciones tributarias (Retención en la fuente,
-- IVA y Renta). Solo adiciones.
--
-- Una declaración se guarda una vez por empresa y el Generador calcula su
-- efecto a cada fecha de corte (no se crean movimientos contables): así un
-- saldo a favor de IVA funciona como foto del último periodo terminado, el
-- anticipo de renta solo en el año siguiente y una cuenta por pagar deja de
-- existir desde su fecha de pago. Las cuentas PUC son globales y se guardan en
-- fs_puc_settings (claves tax.*). Valores en centavos enteros.

-- Configuración tributaria por empresa: periodicidad de IVA (NULL = sin configurar).
CREATE TABLE IF NOT EXISTS fs_tax_company_settings (
    company_id      INTEGER PRIMARY KEY REFERENCES companies(id),
    vat_periodicity TEXT CHECK (vat_periodicity IS NULL OR vat_periodicity IN ('bimonthly', 'four_monthly')),
    updated_at      TEXT NOT NULL
);

--   tax_type: withholding (350, mensual) | vat (300) | income (110, anual).
--   period_start / period_end: periodo fiscal (Renta: año gravable completo).
--   superseded_by: corrección que la reemplazó (se conserva para la trazabilidad, ya no cuenta).
--   payment_date: registrada a mano; nunca se deduce de la fecha de presentación.
--   resolution: si la declaración trae saldo a pagar Y a favor, cuál vale ('' = sin resolver).
--   detail: lectura completa del formulario (casillas, patrimonio declarado — solo informativo —, avisos).
CREATE TABLE IF NOT EXISTS fs_tax_returns (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id             INTEGER NOT NULL REFERENCES companies(id),
    tax_type               TEXT NOT NULL CHECK (tax_type IN ('withholding', 'vat', 'income')),
    year                   INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    period                 INTEGER CHECK (period IS NULL OR period BETWEEN 1 AND 12),
    periodicity            TEXT NOT NULL CHECK (periodicity IN ('monthly', 'bimonthly', 'four_monthly', 'annual')),
    period_start           TEXT NOT NULL CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    period_end             TEXT NOT NULL CHECK (period_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    form_number            TEXT NOT NULL DEFAULT '',
    previous_form_number   TEXT NOT NULL DEFAULT '',
    is_correction          INTEGER NOT NULL DEFAULT 0 CHECK (is_correction IN (0, 1)),
    superseded_by          INTEGER REFERENCES fs_tax_returns(id),
    payable_cents          INTEGER NOT NULL DEFAULT 0 CHECK (payable_cents >= 0),
    favor_cents            INTEGER NOT NULL DEFAULT 0 CHECK (favor_cents >= 0),
    payment_date           TEXT CHECK (payment_date IS NULL OR payment_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    resolution             TEXT NOT NULL DEFAULT '' CHECK (resolution IN ('', 'payable', 'favor')),
    nit                    TEXT NOT NULL DEFAULT '',
    company_name           TEXT NOT NULL DEFAULT '',
    file_name              TEXT NOT NULL DEFAULT '',
    income_ordinary_cents  INTEGER,
    income_loss_cents      INTEGER,
    advance_next_cents     INTEGER,
    advance_target_year    INTEGER,
    detail                 TEXT NOT NULL DEFAULT '{}',
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_tax_returns_company ON fs_tax_returns (company_id, tax_type, year);
-- El número de formulario DIAN es único: el mismo formulario nunca se guarda dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fs_tax_returns_form ON fs_tax_returns (form_number) WHERE form_number <> '';

-- Historial de cada declaración: importación, corrección, fecha de pago, resolución.
CREATE TABLE IF NOT EXISTS fs_tax_return_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id   INTEGER NOT NULL REFERENCES fs_tax_returns(id),
    action      TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_tax_return_events_return ON fs_tax_return_events (return_id);
