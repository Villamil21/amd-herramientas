-- 027: Estados Financieros → Compras, costos y exógena (formatos 1001, 1005 y 1006). Solo adiciones.
--
-- Facturas de compra persistentes por NIT del comprador (texto, sin FK a empresas: la empresa se resuelve por NIT) y año de
-- expedición. Se guarda el ORIGEN (documento leído, con sus líneas en `data`) y las decisiones del usuario; EEFF y Exógena
-- se recalculan siempre desde aquí.

-- Una carga = una carpeta importada. Puede traer facturas de varios años (y, como excepción señalada, de otro NIT).
CREATE TABLE IF NOT EXISTS purchase_uploads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_name  TEXT NOT NULL CHECK (trim(folder_name) <> ''),
    buyer_nit    TEXT NOT NULL DEFAULT '',
    file_count   INTEGER NOT NULL DEFAULT 0,
    -- Resumen de la carga (JSON): archivos ilegibles, excepciones de NIT…
    summary      TEXT NOT NULL DEFAULT '{}',
    imported_at  TEXT NOT NULL
);

-- Un documento por archivo. current: alimenta los cálculos · evidence: duplicado de uno vigente (solo evidencia) ·
-- superseded: sustituido, por autorización explícita, por una versión posterior.
CREATE TABLE IF NOT EXISTS purchase_documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id     INTEGER NOT NULL REFERENCES purchase_uploads(id) ON DELETE CASCADE,
    file_name     TEXT NOT NULL,
    buyer_nit     TEXT NOT NULL DEFAULT '',
    buyer_name    TEXT NOT NULL DEFAULT '',
    year          INTEGER,
    issue_date    TEXT,
    issuer_nit    TEXT NOT NULL DEFAULT '',
    issuer_name   TEXT NOT NULL DEFAULT '',
    number_key    TEXT NOT NULL DEFAULT '',
    total_cents   INTEGER,
    title_key     TEXT NOT NULL DEFAULT '',
    cufe          TEXT,
    fingerprint   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'evidence', 'superseded')),
    duplicate_of  INTEGER REFERENCES purchase_documents(id) ON DELETE SET NULL,
    data          TEXT NOT NULL DEFAULT '{}',
    imported_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_scope ON purchase_documents (buyer_nit, year);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_key ON purchase_documents (buyer_nit, issuer_nit, number_key);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_upload ON purchase_documents (upload_id);

-- Reglas confirmadas producto/proveedor → PUC, concepto 1001 y retención (con historial de cada cambio).
CREATE TABLE IF NOT EXISTS purchase_rules (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_nit        TEXT NOT NULL CHECK (trim(supplier_nit) <> ''),
    product_key         TEXT NOT NULL CHECK (trim(product_key) <> ''),
    product_label       TEXT NOT NULL DEFAULT '',
    puc_code            TEXT NOT NULL DEFAULT '',
    concept_1001        TEXT NOT NULL DEFAULT '',
    retention           TEXT NOT NULL DEFAULT '[]',
    uses                INTEGER NOT NULL DEFAULT 1,
    source_document_id  INTEGER,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE (supplier_nit, product_key)
);

CREATE TABLE IF NOT EXISTS purchase_rule_history (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id             INTEGER NOT NULL REFERENCES purchase_rules(id) ON DELETE CASCADE,
    supplier_nit        TEXT NOT NULL,
    product_key         TEXT NOT NULL,
    puc_code            TEXT NOT NULL DEFAULT '',
    concept_1001        TEXT NOT NULL DEFAULT '',
    retention           TEXT NOT NULL DEFAULT '[]',
    source_document_id  INTEGER,
    changed_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_rule_history_rule ON purchase_rule_history (rule_id);

-- Clasificación confirmada de cada línea. scope: 'rule' (también guardada como regla) o 'invoice' (solo esta factura).
CREATE TABLE IF NOT EXISTS purchase_line_class (
    document_id   INTEGER NOT NULL REFERENCES purchase_documents(id) ON DELETE CASCADE,
    line_index    INTEGER NOT NULL CHECK (line_index >= 0),
    puc_code      TEXT NOT NULL DEFAULT '',
    concept_1001  TEXT NOT NULL DEFAULT '',
    retention     TEXT NOT NULL DEFAULT '[]',
    rule_id       INTEGER REFERENCES purchase_rules(id) ON DELETE SET NULL,
    scope         TEXT NOT NULL DEFAULT 'invoice' CHECK (scope IN ('rule', 'invoice')),
    confirmed_at  TEXT NOT NULL,
    PRIMARY KEY (document_id, line_index)
);

-- Decisiones por documento: confirmar nombre del comprador, qué hacer con la retención de un O-15 / O-47, excluir.
CREATE TABLE IF NOT EXISTS purchase_doc_flags (
    document_id  INTEGER NOT NULL REFERENCES purchase_documents(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('name_confirm', 'retention_decision', 'exclude')),
    value        TEXT NOT NULL,
    decided_at   TEXT NOT NULL,
    PRIMARY KEY (document_id, kind)
);

-- Homologación persistente de encabezados de documento: compra o devolución.
CREATE TABLE IF NOT EXISTS purchase_title_types (
    title_key      TEXT PRIMARY KEY CHECK (trim(title_key) <> ''),
    display_title  TEXT NOT NULL CHECK (trim(display_title) <> ''),
    kind           TEXT NOT NULL CHECK (kind IN ('purchase', 'return')),
    is_system      INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    updated_at     TEXT NOT NULL
);
INSERT OR IGNORE INTO purchase_title_types (title_key, display_title, kind, is_system, updated_at) VALUES
    ('factura electronica de venta', 'FACTURA ELECTRÓNICA DE VENTA', 'purchase', 1, '2026-10-17T00:00:00Z'),
    ('nota credito electronica', 'NOTA CRÉDITO ELECTRÓNICA', 'return', 1, '2026-10-17T00:00:00Z');

CREATE TABLE IF NOT EXISTS purchase_audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_nit  TEXT NOT NULL DEFAULT '',
    year       INTEGER,
    event      TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_audit_scope ON purchase_audit (buyer_nit, year);

-- Responsabilidad frente al IVA (responsabilidad 48 del RUT) con fecha efectiva: un cambio aplica desde su vigencia.
CREATE TABLE IF NOT EXISTS company_vat_history (
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    effective_date  TEXT NOT NULL,
    responsible     INTEGER NOT NULL CHECK (responsible IN (0, 1)),
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('rut', 'manual')),
    note            TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    PRIMARY KEY (company_id, effective_date)
);

-- Régimen fiscal del proveedor con fecha efectiva (cada factura usa el vigente en su fecha). Se identifica por NIT.
CREATE TABLE IF NOT EXISTS supplier_fiscal_history (
    supplier_nit    TEXT NOT NULL,
    effective_date  TEXT NOT NULL,
    regime          TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('factura', 'manual', 'proveedor')),
    note            TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    PRIMARY KEY (supplier_nit, effective_date)
);
-- El régimen que ya tenía cada proveedor queda como punto de partida del historial.
INSERT OR IGNORE INTO supplier_fiscal_history (supplier_nit, effective_date, regime, source, note, created_at)
    SELECT nit, '1900-01-01', fiscal_regime, 'proveedor', 'Régimen guardado antes del historial', '2026-10-17T00:00:00Z'
    FROM suppliers WHERE fiscal_regime IS NOT NULL AND trim(fiscal_regime) <> '';

-- Concepto 1001 sugerido por código PUC.
CREATE TABLE IF NOT EXISTS puc_concept_1001 (
    puc_code      TEXT PRIMARY KEY CHECK (trim(puc_code) <> ''),
    concept_code  TEXT NOT NULL CHECK (trim(concept_code) <> ''),
    updated_at    TEXT NOT NULL
);

-- Conceptos de un formato de Exógena por año (código, nombre, vigencia e historial editables).
CREATE TABLE IF NOT EXISTS exo_year_concepts (
    format_code  TEXT NOT NULL CHECK (format_code <> '' AND format_code NOT GLOB '*[^0-9]*'),
    year         INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    code         TEXT NOT NULL CHECK (trim(code) <> ''),
    description  TEXT NOT NULL CHECK (trim(description) <> ''),
    valid_from   TEXT NOT NULL,
    valid_to     TEXT NOT NULL DEFAULT '',
    is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    is_system    INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (format_code, year, code)
);

CREATE TABLE IF NOT EXISTS exo_year_concept_audit (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    format_code  TEXT NOT NULL,
    year         INTEGER NOT NULL,
    code         TEXT NOT NULL,
    action       TEXT NOT NULL CHECK (action IN ('add', 'edit', 'activate', 'deactivate', 'delete', 'copy')),
    old_value    TEXT NOT NULL DEFAULT '',
    new_value    TEXT NOT NULL DEFAULT '',
    changed_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exo_year_concept_audit ON exo_year_concept_audit (format_code, year);

-- Catálogo 1001: 2025 oficial (de sistema) y una copia editable para 2026. Sin otros conceptos.
INSERT OR IGNORE INTO exo_year_concepts (format_code, year, code, description, valid_from, valid_to, is_active, is_system, updated_at)
SELECT '1001', y.column1, c.column1, c.column2, y.column2, y.column3, 1, y.column4, '2026-10-17T00:00:00Z'
FROM (VALUES
    ('5002', 'Honorarios'),
    ('5003', 'Comisiones'),
    ('5004', 'Servicios'),
    ('5005', 'Arrendamientos'),
    ('5006', 'Intereses y rendimientos causados'),
    ('5063', 'Intereses y rendimientos pagados'),
    ('5007', 'Compra de activos movibles'),
    ('5008', 'Compra de activos fijos'),
    ('5010', 'Aportes parafiscales (SENA, CCF, ICBF)'),
    ('5011', 'EPS y riesgos laborales'),
    ('5012', 'Pensiones obligatorias'),
    ('5015', 'Impuestos solicitados como deducción'),
    ('5101', 'Gravamen a los movimientos financieros'),
    ('5066', 'Impuesto nacional al consumo'),
    ('5016', 'Demás costos y deducciones'),
    ('5029 a 5035', 'Gastos pagados por anticipado'),
    ('5019', 'Amortizaciones'),
    ('5088', 'Costos o gastos por diferencia en cambio')
) AS c
CROSS JOIN (VALUES
    (2025, '2025-01-01', '2025-12-31', 1),
    (2026, '2026-01-01', '2026-12-31', 0)
) AS y;
