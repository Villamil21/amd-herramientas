-- 020: Obligaciones tributarias — «Registrar periodo sin obligación». Solo adiciones.
--
-- Un periodo (mes de Retefuente, bimestre / cuatrimestre de IVA o año de
-- Renta) en el que la empresa no tuvo que declarar. Cubre el periodo en la
-- cobertura sin crear una declaración ni valores. Nunca se borra: anularlo lo
-- deja «voided» con su fecha. confirmation: el texto que confirmó el usuario.
CREATE TABLE IF NOT EXISTS fs_tax_empty_periods (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id    INTEGER NOT NULL REFERENCES companies(id),
    tax_type      TEXT NOT NULL CHECK (tax_type IN ('withholding', 'vat', 'income')),
    year          INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    period        INTEGER CHECK (period IS NULL OR period BETWEEN 1 AND 12),
    periodicity   TEXT NOT NULL CHECK (periodicity IN ('monthly', 'bimonthly', 'four_monthly', 'annual')),
    confirmation  TEXT NOT NULL CHECK (trim(confirmation) <> ''),
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
    created_at    TEXT NOT NULL,
    voided_at     TEXT
);
-- Un solo registro vigente por empresa, impuesto y periodo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fs_tax_empty_periods_active
    ON fs_tax_empty_periods (company_id, tax_type, year, periodicity, IFNULL(period, 0)) WHERE status = 'active';
