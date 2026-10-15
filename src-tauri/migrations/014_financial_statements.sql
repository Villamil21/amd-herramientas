-- 014: Estados Financieros — motor de movimientos contables por empresa.
--
-- Solo adiciones, con una excepción pedida expresamente: el historial
-- «proveedor → códigos PUC usados» se reinicia. Las dos tablas que lo
-- guardaban se conservan como archivo (renombradas, nunca se borran) y se
-- crea una tabla vacía en su lugar.
--
-- Valores: centavos enteros (exactos). El redondeo al millar es solo de
-- presentación y nunca se guarda.

-- ---------------------------------------------------------------------------
-- 1. Empresas, firmas y SMMLV
-- ---------------------------------------------------------------------------

-- Representante legal (el cargo siempre es «Representante Legal»: no se guarda).
ALTER TABLE companies ADD COLUMN legal_rep_name TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN legal_rep_document TEXT NOT NULL DEFAULT '';

-- Cómo se muestra el contador en los Estados Financieros. Vacío = sin definir
-- (nunca se deduce del nombre).
ALTER TABLE certificate_signers ADD COLUMN accountant_title TEXT NOT NULL DEFAULT ''
    CHECK (accountant_title IN ('', 'Contador Público', 'Contadora Pública'));

-- Auxilio de transporte por año (pesos enteros). NULL = sin configurar.
ALTER TABLE minimum_wages ADD COLUMN transport_allowance_pesos INTEGER
    CHECK (transport_allowance_pesos IS NULL OR transport_allowance_pesos > 0);
UPDATE minimum_wages SET transport_allowance_pesos = 249095 WHERE year = 2026 AND transport_allowance_pesos IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Códigos PUC personalizados (globales para todas las empresas)
-- ---------------------------------------------------------------------------

-- El catálogo oficial (puc_codes) sigue siendo de solo lectura. Un código
-- personalizado solo existe si el usuario lo creó (salvo 7305, ver abajo); su
-- concepto lo escribe el usuario y el padre lo confirma él. No puede repetir un
-- código oficial (se valida en Rust).
CREATE TABLE IF NOT EXISTS puc_custom_codes (
    code         TEXT PRIMARY KEY CHECK (length(code) BETWEEN 4 AND 12 AND code NOT GLOB '*[^0-9]*'),
    concept      TEXT NOT NULL CHECK (trim(concept) <> ''),
    parent_code  TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

-- 73 COSTOS INDIRECTOS (oficial) └── 7305 NO APLICA: válido para registrar
-- movimientos, pero excluido de los Estados Financieros (ver fs_puc_mappings).
INSERT OR IGNORE INTO puc_custom_codes (code, concept, parent_code, created_at, updated_at)
VALUES ('7305', 'NO APLICA', '73', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- ---------------------------------------------------------------------------
-- 3. Reinicio del historial «proveedor → códigos PUC usados»
-- ---------------------------------------------------------------------------

-- Solo esta relación: proveedores, tabla PUC y facturas no se tocan.
ALTER TABLE supplier_puc_codes RENAME TO supplier_puc_codes_archive_014;
ALTER TABLE supplier_puc_codes_by_nit RENAME TO supplier_puc_codes_by_nit_archive_014;
CREATE TABLE supplier_puc_codes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id   INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    -- Oficial de 6 dígitos o personalizado (se valida en Rust contra ambas tablas).
    puc_code      TEXT NOT NULL CHECK (puc_code <> '' AND puc_code NOT GLOB '*[^0-9]*'),
    usage_count   INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    last_used_at  TEXT NOT NULL,
    UNIQUE (supplier_id, puc_code)
);

-- ---------------------------------------------------------------------------
-- 4. Catálogo de cuentas de Estados Financieros
-- ---------------------------------------------------------------------------

-- Líneas internas de cada sección. Los encabezados, subtotales y resultados
-- son estructurales (los arma el generador) y no están aquí.
--   section: ESF → asset_current, asset_noncurrent, liability_current,
--            liability_noncurrent, equity.
--            EERR → income, costs, admin_expenses, sales_expenses,
--            other_income, other_expenses.
--   role: línea con cálculo automático (capital social, resultado del
--         ejercicio) o usada por la presentación Banco / OTC.
CREATE TABLE IF NOT EXISTS fs_lines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    section     TEXT NOT NULL CHECK (section IN ('asset_current', 'asset_noncurrent', 'liability_current', 'liability_noncurrent', 'equity',
                                                 'income', 'costs', 'admin_expenses', 'sales_expenses', 'other_income', 'other_expenses')),
    name        TEXT NOT NULL CHECK (trim(name) <> ''),
    sort_order  INTEGER NOT NULL,
    role        TEXT UNIQUE CHECK (role IS NULL OR role IN ('share_capital', 'period_result', 'sales', 'third_party_income', 'cost_of_sales', 'third_party_cost')),
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Cuenta representativa de cada sección (se muestra en 0 si la sección está vacía).
CREATE TABLE IF NOT EXISTS fs_sections (
    section                 TEXT PRIMARY KEY,
    representative_line_id  INTEGER REFERENCES fs_lines(id)
);

-- PUC → línea de Estados Financieros, o «No afecta Estados Financieros».
-- Es la única fuente de verdad: nunca se deduce del signo, prefijo ni descripción.
CREATE TABLE IF NOT EXISTS fs_puc_mappings (
    puc_code    TEXT PRIMARY KEY,
    line_id     INTEGER REFERENCES fs_lines(id),
    excluded    INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0, 1)),
    updated_at  TEXT NOT NULL,
    CHECK ((line_id IS NULL AND excluded = 1) OR (line_id IS NOT NULL AND excluded = 0))
);

-- Trazabilidad de cada cambio de clasificación.
CREATE TABLE IF NOT EXISTS fs_puc_mapping_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    puc_code     TEXT NOT NULL,
    old_line_id  INTEGER,
    old_excluded INTEGER,
    new_line_id  INTEGER,
    new_excluded INTEGER NOT NULL,
    changed_at   TEXT NOT NULL
);

INSERT OR IGNORE INTO fs_lines (id, section, name, sort_order, role, created_at, updated_at)
    SELECT column1, column2, column3, column4, column5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    FROM (VALUES
    (1, 'asset_current', 'Disponible', 1, NULL),
    (2, 'asset_current', 'Activos intangibles', 2, NULL),
    (3, 'asset_noncurrent', 'Propiedades, planta y equipo', 1, NULL),
    (4, 'liability_current', 'Obligaciones financieras', 1, NULL),
    (5, 'liability_current', 'Proveedores', 2, NULL),
    (6, 'liability_current', 'Cuentas por pagar', 3, NULL),
    (7, 'liability_current', 'Impuestos, gravámenes y tasas', 4, NULL),
    (8, 'liability_current', 'Obligaciones laborales', 5, NULL),
    (9, 'liability_current', 'Pasivos estimados y provisiones', 6, NULL),
    (10, 'liability_current', 'Diferidos', 7, NULL),
    (11, 'liability_current', 'Otros pasivos', 8, NULL),
    (12, 'liability_current', 'Bonos y papeles comerciales', 9, NULL),
    (13, 'liability_noncurrent', 'Otros pasivos', 1, NULL),
    (14, 'equity', 'Capital social', 1, 'share_capital'),
    (15, 'equity', 'Reservas', 2, NULL),
    (16, 'equity', 'Resultados del ejercicio', 3, 'period_result'),
    (17, 'equity', 'Resultados de ejercicios anteriores', 4, NULL),
    (18, 'income', 'Ventas', 1, 'sales'),
    (19, 'income', 'Ingresos para terceros', 2, 'third_party_income'),
    (20, 'income', 'Devoluciones y Descuentos', 3, NULL),
    (21, 'costs', 'Costo de Ventas', 1, 'cost_of_sales'),
    (22, 'costs', 'Costo de terceros', 2, 'third_party_cost'),
    (23, 'admin_expenses', 'Gastos de personal', 1, NULL),
    (24, 'admin_expenses', 'Honorarios', 2, NULL),
    (25, 'admin_expenses', 'Arrendamientos', 3, NULL),
    (26, 'admin_expenses', 'Servicios', 4, NULL),
    (27, 'admin_expenses', 'Gastos legales', 5, NULL),
    (28, 'admin_expenses', 'Diversos', 6, NULL),
    (29, 'sales_expenses', 'Gastos de personal', 1, NULL),
    (30, 'sales_expenses', 'Servicios', 2, NULL),
    (31, 'sales_expenses', 'Diversos', 3, NULL),
    (32, 'other_income', 'Otros Ingresos', 1, NULL),
    (33, 'other_expenses', 'Otros Gastos', 1, NULL),
    (34, 'other_expenses', 'Otros Gastos financieros', 2, NULL));

INSERT OR IGNORE INTO fs_sections (section, representative_line_id) VALUES
    ('asset_current', 1), ('asset_noncurrent', 3), ('liability_current', 6), ('liability_noncurrent', 13), ('equity', 14),
    ('income', 18), ('costs', 21), ('admin_expenses', 28), ('sales_expenses', 31), ('other_income', 32), ('other_expenses', 33);

INSERT OR IGNORE INTO fs_puc_mappings (puc_code, line_id, excluded, updated_at)
VALUES ('7305', NULL, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- ---------------------------------------------------------------------------
-- 5. Lotes de importación y movimientos contables
-- ---------------------------------------------------------------------------

-- Un lote = un envío a Estados Financieros desde un submódulo.
--   source: purchases | bank | payroll | sales_einvoice | sales_tpsv | opening | adjustment
--   dedupe_key: identifica el envío (ej. banco + cuenta + periodo) para detectar reenvíos.
--   status: active | replaced (reemplazado por replaced_by) | voided.
CREATE TABLE IF NOT EXISTS fs_batches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id    INTEGER NOT NULL REFERENCES companies(id),
    source        TEXT NOT NULL,
    file_name     TEXT NOT NULL DEFAULT '',
    period_label  TEXT NOT NULL DEFAULT '',
    period_start  TEXT,
    period_end    TEXT,
    dedupe_key    TEXT NOT NULL DEFAULT '',
    record_count  INTEGER NOT NULL DEFAULT 0,
    total_cents   INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'voided')),
    replaced_by   INTEGER REFERENCES fs_batches(id),
    metadata      TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_batches_company ON fs_batches (company_id, source, status);

-- Movimiento individual. amount_cents lleva el signo que suma en su línea
-- (ej. nota crédito en negativo). dc: solo extractos bancarios, donde el signo
-- depende de la naturaleza de la sección destino (D = salida del banco,
-- C = entrada). settles_on: fecha en que se paga una cuenta por pagar (deja de
-- estar en el ESF a partir de ese día); NULL = pendiente.
CREATE TABLE IF NOT EXISTS fs_movements (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id       INTEGER NOT NULL REFERENCES companies(id),
    batch_id         INTEGER NOT NULL REFERENCES fs_batches(id),
    accounting_date  TEXT NOT NULL CHECK (accounting_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    source           TEXT NOT NULL,
    concept_key      TEXT NOT NULL DEFAULT '',
    document_id      TEXT NOT NULL DEFAULT '',
    document_number  TEXT NOT NULL DEFAULT '',
    document_type    TEXT NOT NULL DEFAULT '',
    supplier_id      INTEGER,
    supplier_nit     TEXT NOT NULL DEFAULT '',
    supplier_name    TEXT NOT NULL DEFAULT '',
    employee_id      INTEGER,
    employment_id    INTEGER,
    bank             TEXT NOT NULL DEFAULT '',
    account_number   TEXT NOT NULL DEFAULT '',
    puc_code         TEXT NOT NULL CHECK (puc_code <> '' AND puc_code NOT GLOB '*[^0-9]*'),
    puc_concept      TEXT NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    amount_cents     INTEGER NOT NULL,
    dc               TEXT CHECK (dc IS NULL OR dc IN ('D', 'C')),
    settles_on       TEXT,
    status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'ignored', 'adjusted', 'voided')),
    detail           TEXT NOT NULL DEFAULT '{}',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_movements_company_date ON fs_movements (company_id, status, accounting_date);
CREATE INDEX IF NOT EXISTS idx_fs_movements_document ON fs_movements (company_id, source, document_id);
CREATE INDEX IF NOT EXISTS idx_fs_movements_batch ON fs_movements (batch_id);

-- Decisiones del usuario que deben quedar trazadas (ej. «Procesar de todas
-- formas» una factura cuyo nombre no coincide con el de la empresa).
CREATE TABLE IF NOT EXISTS fs_decisions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id    INTEGER NOT NULL REFERENCES companies(id),
    batch_id      INTEGER REFERENCES fs_batches(id),
    source        TEXT NOT NULL,
    document_key  TEXT NOT NULL DEFAULT '',
    decision      TEXT NOT NULL,
    detail        TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 6. Extractos bancarios
-- ---------------------------------------------------------------------------

-- Banco + concepto exacto → PUC (global para todas las empresas). «No enviar»
-- nunca se guarda: es una decisión de cada extracto.
CREATE TABLE IF NOT EXISTS fs_bank_concept_mappings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bank        TEXT NOT NULL,
    concept     TEXT NOT NULL,
    puc_code    TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (bank, concept)
);

-- Empresa + banco + número de cuenta → PUC del saldo bancario.
CREATE TABLE IF NOT EXISTS fs_bank_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id      INTEGER NOT NULL REFERENCES companies(id),
    bank            TEXT NOT NULL,
    account_number  TEXT NOT NULL,
    puc_code        TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (company_id, bank, account_number)
);

-- Saldo final de un extracto: una foto a una fecha, nunca un movimiento
-- acumulable. Vigente mientras su lote esté activo.
CREATE TABLE IF NOT EXISTS fs_bank_balances (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id      INTEGER NOT NULL REFERENCES companies(id),
    batch_id        INTEGER NOT NULL REFERENCES fs_batches(id),
    bank            TEXT NOT NULL,
    account_number  TEXT NOT NULL,
    balance_date    TEXT NOT NULL,
    balance_cents   INTEGER NOT NULL,
    puc_code        TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 7. Nómina
-- ---------------------------------------------------------------------------

-- Llave: tipo + número de documento (nunca el nombre).
CREATE TABLE IF NOT EXISTS fs_employees (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id),
    doc_type    TEXT NOT NULL,
    doc_number  TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (company_id, doc_type, doc_number)
);

-- Área contable con vigencia (AAAA-MM). Un cambio agrega una fila: el histórico no se reescribe.
CREATE TABLE IF NOT EXISTS fs_employee_areas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id     INTEGER NOT NULL REFERENCES fs_employees(id),
    area            TEXT NOT NULL CHECK (area IN ('admin', 'sales')),
    effective_from  TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    created_at      TEXT NOT NULL,
    UNIQUE (employee_id, effective_from)
);

-- Vinculaciones (#1, #2…): un reingreso abre una nueva; las provisiones no se mezclan.
CREATE TABLE IF NOT EXISTS fs_employments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id  INTEGER NOT NULL REFERENCES fs_employees(id),
    number       INTEGER NOT NULL,
    hire_date    TEXT NOT NULL,
    end_date     TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (employee_id, number)
);

CREATE TABLE IF NOT EXISTS fs_liquidations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id        INTEGER NOT NULL REFERENCES companies(id),
    employee_id       INTEGER NOT NULL REFERENCES fs_employees(id),
    employment_id     INTEGER NOT NULL UNIQUE REFERENCES fs_employments(id),
    liquidation_date  TEXT NOT NULL,
    last_period       TEXT NOT NULL,
    prima_cents       INTEGER NOT NULL,
    cesantias_cents   INTEGER NOT NULL,
    intereses_cents   INTEGER NOT NULL,
    vacaciones_cents  INTEGER NOT NULL,
    notes             TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL
);

-- «No se retiró»: justificación obligatoria y persistente de una ausencia.
CREATE TABLE IF NOT EXISTS fs_absence_justifications (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id     INTEGER NOT NULL REFERENCES companies(id),
    employee_id    INTEGER NOT NULL REFERENCES fs_employees(id),
    period         TEXT NOT NULL,
    justification  TEXT NOT NULL CHECK (trim(justification) <> ''),
    created_at     TEXT NOT NULL,
    UNIQUE (employee_id, period)
);

-- Fila de planilla por empleado (vigente mientras su lote esté activo).
CREATE TABLE IF NOT EXISTS fs_payroll_rows (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id     INTEGER NOT NULL REFERENCES companies(id),
    batch_id       INTEGER NOT NULL REFERENCES fs_batches(id),
    employee_id    INTEGER NOT NULL REFERENCES fs_employees(id),
    employment_id  INTEGER NOT NULL REFERENCES fs_employments(id),
    period         TEXT NOT NULL,
    payment_date   TEXT NOT NULL,
    detail         TEXT NOT NULL DEFAULT '{}',
    created_at     TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 8. Configuración global y ventas
-- ---------------------------------------------------------------------------

-- Cuentas PUC globales por concepto (nómina, ventas, TPSV…). Clave → código.
CREATE TABLE IF NOT EXISTS fs_puc_settings (
    key         TEXT PRIMARY KEY,
    puc_code    TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Ventas → Facturación electrónica: tipo de documento → Venta / Devolución / Ignorar.
CREATE TABLE IF NOT EXISTS fs_sales_doc_types (
    normalized_label  TEXT PRIMARY KEY,
    original_label    TEXT NOT NULL,
    category          TEXT NOT NULL CHECK (category IN ('sale', 'return', 'ignore')),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
INSERT OR IGNORE INTO fs_sales_doc_types (normalized_label, original_label, category, created_at, updated_at) VALUES
    ('factura electronica', 'Factura electrónica', 'sale', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('nota de credito electronica', 'Nota de crédito electrónica', 'return', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- Saldos iniciales en edición (aún no enviados). rows: JSON [{pucCode, concept, amountCents}].
CREATE TABLE IF NOT EXISTS fs_opening_drafts (
    company_id    INTEGER NOT NULL REFERENCES companies(id),
    balance_date  TEXT NOT NULL,
    rows          TEXT NOT NULL DEFAULT '[]',
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (company_id, balance_date)
);

-- ---------------------------------------------------------------------------
-- 9. Ajustes manuales (siempre con trazabilidad)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fs_adjustments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id       INTEGER NOT NULL REFERENCES companies(id),
    movement_id      INTEGER NOT NULL REFERENCES fs_movements(id),
    accounting_date  TEXT NOT NULL,
    puc_code         TEXT NOT NULL,
    concept          TEXT NOT NULL,
    reason           TEXT NOT NULL CHECK (trim(reason) <> ''),
    previous_cents   INTEGER NOT NULL,
    adjustment_type  TEXT NOT NULL CHECK (adjustment_type IN ('replace', 'delta')),
    input_cents      INTEGER NOT NULL,
    final_cents      INTEGER NOT NULL,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

-- Cada edición guarda el ajuste tal como estaba (JSON) antes del cambio.
CREATE TABLE IF NOT EXISTS fs_adjustment_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    adjustment_id  INTEGER NOT NULL REFERENCES fs_adjustments(id),
    previous       TEXT NOT NULL,
    edited_at      TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 10. Periodos, cierre y versiones
-- ---------------------------------------------------------------------------

-- Empresa + rango + presentación (bank | otc: solo interna, nunca en el PDF).
--   status: preparing | ready | pdf_generated | needs_review | closed
--   validation_hash: huella de los valores cuando se marcó «Cuadrado».
--   closed_snapshot: valores exactos aprobados al cerrar (JSON).
CREATE TABLE IF NOT EXISTS fs_periods (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id       INTEGER NOT NULL REFERENCES companies(id),
    start_date       TEXT NOT NULL,
    end_date         TEXT NOT NULL,
    presentation     TEXT NOT NULL CHECK (presentation IN ('bank', 'otc')),
    status           TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'ready', 'pdf_generated', 'needs_review', 'closed')),
    validation_hash  TEXT,
    review_reason    TEXT NOT NULL DEFAULT '',
    closed_snapshot  TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    UNIQUE (company_id, start_date, end_date, presentation)
);

CREATE TABLE IF NOT EXISTS fs_period_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id   INTEGER NOT NULL REFERENCES fs_periods(id),
    action      TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

-- Cada PDF generado es una versión con su snapshot exacto (nunca se sobrescribe).
CREATE TABLE IF NOT EXISTS fs_statement_versions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id     INTEGER NOT NULL REFERENCES fs_periods(id),
    version       INTEGER NOT NULL,
    file_name     TEXT NOT NULL,
    snapshot      TEXT NOT NULL,
    generated_at  TEXT NOT NULL,
    UNIQUE (period_id, version)
);
