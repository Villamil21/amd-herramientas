-- 032: Ventas por facturación electrónica → Exógena 1007, 1005 y 1006. Solo adiciones.
--
-- 1) `exo_einvoice_docs`: el detalle de cada documento de venta que se importó (la fuente de verdad de los tres formatos).
--    Se guarda por empresa y documento (CUFE/CUDE o NIT emisor + número); el año sale de la fecha de emisión, así un mismo
--    Excel con años distintos queda disponible en cada año sin volver a subirlo. Una reimportación NO duplica: actualiza
--    solo con confirmación explícita. Los formatos se recalculan siempre desde aquí; nada calculado es fuente de verdad.
-- 2) `exo_einvoice_customers`: identidad confirmada de los clientes (receptores) que no son NIT 90xxxxxxx, para no volver a
--    pedirla en 1007, 1005 y 1006.

CREATE TABLE IF NOT EXISTS exo_einvoice_docs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    document_id        TEXT NOT NULL CHECK (trim(document_id) <> ''),
    year               INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    issue_date         TEXT NOT NULL,
    doc_type           TEXT NOT NULL,
    doc_type_key       TEXT NOT NULL,
    -- sale: factura · return: nota crédito (clasificación vigente al importar).
    category           TEXT NOT NULL CHECK (category IN ('sale', 'return')),
    number             TEXT NOT NULL DEFAULT '',
    file_name          TEXT NOT NULL DEFAULT '',
    sheet              TEXT NOT NULL DEFAULT '',
    row_number         INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT '',
    receiver_nit_raw   TEXT NOT NULL DEFAULT '',
    receiver_name      TEXT NOT NULL DEFAULT '',
    total_cents        INTEGER NOT NULL,
    iva_cents          INTEGER NOT NULL DEFAULT 0,
    -- Base de Estados Financieros: Total − (IVA … Rete ICA). No cambia.
    eeff_base_cents    INTEGER NOT NULL,
    eeff_columns       TEXT NOT NULL DEFAULT '[]',
    -- Base del 1007: Total − (IVA … ICUI). NULL si el Excel no trae ICUI ni equivalente y nadie definió el alcance.
    exo_base_cents     INTEGER,
    exo_columns        TEXT NOT NULL DEFAULT '[]',
    imported_at        TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    UNIQUE (company_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_exo_einvoice_docs_year ON exo_einvoice_docs (company_id, year);

CREATE TABLE IF NOT EXISTS exo_einvoice_customers (
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    doc_number      TEXT NOT NULL CHECK (trim(doc_number) <> ''),
    doc_type_code   TEXT NOT NULL CHECK (trim(doc_type_code) <> ''),
    dv              TEXT NOT NULL DEFAULT '',
    first_surname   TEXT NOT NULL DEFAULT '',
    second_surname  TEXT NOT NULL DEFAULT '',
    first_name      TEXT NOT NULL DEFAULT '',
    other_names     TEXT NOT NULL DEFAULT '',
    business_name   TEXT NOT NULL DEFAULT '',
    confirmed_at    TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (company_id, doc_number)
);
