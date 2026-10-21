-- 034: Extractos bancarios → Exógena 1012, 1007 y 1011. Solo adiciones.
--
-- 1) `fs_bank_profiles`: ficha persistente del banco como informado en Exógena (NIT sin DV, razón social, tipo de documento
--    NIT y país Colombia). Se crea una sola vez desde el módulo bancario y se reutiliza en cada extracto, empresa y año. Es
--    global (el NIT de un banco no depende de la empresa). El DV lo calcula el sistema.
-- 2) `fs_bank_interest_rules`: banco + concepto exacto → es interés generado o no (como las reglas del GMF). Una detección
--    por palabra clave sin regla guardada solo es una sugerencia: nunca entra sola al 1007.
-- 3) `fs_bank_exo_reviews`: decisión del usuario sobre una situación que no se clasifica sola (sobregiro, saldo de naturaleza
--    inesperada, extracto de diciembre que no termina el 31, interés o GMF netos negativos). Hasta que se decide, el valor no
--    entra al formato y el formato queda bloqueado; la decisión es por empresa, año y situación.
-- 4) Conceptos de sistema de los formatos: 1007 → 4003 (ingresos financieros) y 1012 → 1110 (saldo de cuentas corrientes y/o
--    de ahorro en el país). El 1011 → 8211 ya existe (030).
--
-- Los datos de los extractos (saldo final, intereses y GMF por concepto) viajan en `fs_batches.metadata.exogena`: no hay tabla
-- propia, así reemplazos, anulaciones, respaldos y reinicios se comportan igual que con el resto de los extractos.

CREATE TABLE IF NOT EXISTS fs_bank_profiles (
    bank_key       TEXT PRIMARY KEY CHECK (trim(bank_key) <> ''),
    bank           TEXT NOT NULL CHECK (trim(bank) <> ''),
    nit            TEXT NOT NULL CHECK (nit <> '' AND nit NOT GLOB '*[^0-9]*'),
    dv             TEXT NOT NULL CHECK (length(dv) = 1 AND dv GLOB '[0-9]'),
    business_name  TEXT NOT NULL CHECK (trim(business_name) <> ''),
    doc_type_code  TEXT NOT NULL DEFAULT '31' CHECK (doc_type_code = '31'),
    country_code   TEXT NOT NULL DEFAULT '169' CHECK (country_code = '169'),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fs_bank_interest_rules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    bank         TEXT NOT NULL,
    concept      TEXT NOT NULL,
    is_interest  INTEGER NOT NULL CHECK (is_interest IN (0, 1)),
    origin       TEXT NOT NULL CHECK (origin IN ('auto', 'manual')),
    confirmed    INTEGER NOT NULL DEFAULT 1 CHECK (confirmed IN (0, 1)),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (bank, concept)
);

CREATE TABLE IF NOT EXISTS fs_bank_exo_reviews (
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    year        INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    review_key  TEXT NOT NULL CHECK (trim(review_key) <> ''),
    decision    TEXT NOT NULL CHECK (decision IN ('include', 'exclude')),
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (company_id, year, review_key)
);

INSERT OR IGNORE INTO exo_format_concepts (format_code, code, description, is_system, is_active, updated_at) VALUES
    ('1007', '4003', 'Ingresos financieros: intereses y rendimientos financieros recibidos', 1, 1, '2026-10-21T00:00:00Z'),
    ('1012', '1110', 'Saldo a 31 de Diciembre de las cuentas corrientes y/o ahorro que posea en el país', 1, 1, '2026-10-21T00:00:00Z');
