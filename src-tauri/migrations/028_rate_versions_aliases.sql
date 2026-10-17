-- Vigencia por fecha de las tarifas de la Tabla de retenciones. La fila de `withholding_rates` es la regla base (rige desde el
-- inicio hasta la primera vigencia); cada fila de aquí rige desde su fecha efectiva y NO cambia facturas anteriores.
CREATE TABLE IF NOT EXISTS withholding_rate_versions (
    rate_id         INTEGER NOT NULL,
    effective_from  TEXT    NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    base_uvt_centi  INTEGER NOT NULL CHECK (base_uvt_centi >= 0),
    rate_bp         INTEGER NOT NULL CHECK (rate_bp > 0 AND rate_bp <= 10000),
    note            TEXT    NOT NULL DEFAULT '',
    created_at      TEXT    NOT NULL,
    PRIMARY KEY (rate_id, effective_from)
);

-- Alias persistentes de Catálogos Exógena: otro nombre con el que aparece un dato en facturas o archivos y el código oficial al que
-- equivale. `kind`: title_type (alias → encabezado de documento), municipality (alias → código de municipio; `parent` = departamento),
-- department y country (alias → código oficial del catálogo).
CREATE TABLE IF NOT EXISTS exo_aliases (
    kind        TEXT NOT NULL CHECK (kind IN ('title_type', 'municipality', 'department', 'country')),
    alias_key   TEXT NOT NULL CHECK (alias_key <> ''),
    parent      TEXT NOT NULL DEFAULT '',
    alias       TEXT NOT NULL,
    target      TEXT NOT NULL CHECK (target <> ''),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (kind, alias_key, parent)
);
