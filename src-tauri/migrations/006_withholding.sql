-- 006: Impuestos → Retención en la fuente. Solo adiciones: los proveedores y
-- sus datos actuales se conservan (las columnas nuevas quedan en NULL).

-- Datos tributarios del proveedor para retención.
ALTER TABLE suppliers ADD COLUMN person_type TEXT CHECK (person_type IN ('PJ', 'PN'));
-- Régimen / responsabilidad fiscal del emisor tal como se leyó de la factura.
ALTER TABLE suppliers ADD COLUMN fiscal_regime TEXT;
ALTER TABLE suppliers ADD COLUMN fiscal_checked_at TEXT;

-- Tabla de retenciones (dato maestro editable). La base mínima en pesos no se
-- guarda: se calcula con el valor UVT del año. Base UVT en centésimas de UVT
-- (10 UVT → 1000) y tarifa en centésimas de punto (4 % → 400): sin decimales binarios.
CREATE TABLE IF NOT EXISTS withholding_rates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    retention_type  TEXT NOT NULL CHECK (retention_type IN ('fees', 'services', 'rentals', 'purchases')),
    name            TEXT NOT NULL,
    base_uvt_centi  INTEGER NOT NULL CHECK (base_uvt_centi >= 0),
    rate_bp         INTEGER NOT NULL CHECK (rate_bp >= 0 AND rate_bp <= 10000),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (retention_type, name)
);

-- Valor UVT por año (un solo valor para todas las filas de la tabla).
CREATE TABLE IF NOT EXISTS uvt_values (
    year        INTEGER PRIMARY KEY CHECK (year BETWEEN 2000 AND 2100),
    value_pesos INTEGER NOT NULL CHECK (value_pesos > 0),
    updated_at  TEXT NOT NULL
);

-- Reglas de retención de cada proveedor (puede tener varias). Sin llave foránea
-- hacia withholding_rates: si el concepto se elimina, la regla queda visible
-- como error de configuración en lugar de desaparecer.
CREATE TABLE IF NOT EXISTS supplier_withholding_rules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id  INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    rate_id      INTEGER NOT NULL,
    base_mode    TEXT NOT NULL CHECK (base_mode IN ('invoice_subtotal', 'manual')),
    is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (supplier_id, rate_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_withholding_rules_supplier ON supplier_withholding_rules(supplier_id);

-- Clasificación persistente de títulos de documento: Factura o Nota.
CREATE TABLE IF NOT EXISTS document_title_mappings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_title  TEXT NOT NULL UNIQUE,
    display_title     TEXT NOT NULL,
    category          TEXT NOT NULL CHECK (category IN ('invoice', 'credit_note')),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

-- Datos iniciales editables (solo se crean si faltan; nunca sobrescriben).
INSERT OR IGNORE INTO uvt_values (year, value_pesos, updated_at) VALUES (2026, 52374, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO withholding_rates (id, retention_type, name, base_uvt_centi, rate_bp, sort_order, created_at, updated_at) VALUES
    (1,  'purchases', 'Compras generales (declarantes)', 1000, 250, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (2,  'purchases', 'Compras de bienes o productos agrícolas o pecuarios sin procesamiento industrial', 7000, 150, 2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (3,  'purchases', 'Compras de bienes o productos agrícolas o pecuarios con procesamiento industrial (declarantes)', 1000, 250, 3, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (4,  'purchases', 'Compras de combustibles derivados del petróleo', 0, 10, 4, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (5,  'purchases', 'Compras de vehículos', 0, 100, 5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (6,  'services', 'Servicios generales (declarantes)', 200, 400, 6, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (7,  'services', 'Servicios de transporte de carga', 200, 100, 7, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (8,  'services', 'Servicios de transporte nacional de pasajeros por vía terrestre (declarantes)', 1000, 350, 8, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (9,  'services', 'Servicios de transporte nacional de pasajeros por vía aérea o marítima', 200, 100, 9, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (10, 'services', 'Servicios de hoteles y restaurantes (declarantes)', 200, 350, 10, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (11, 'rentals', 'Arrendamiento de bienes muebles', 0, 400, 11, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (12, 'rentals', 'Arrendamiento de bienes inmuebles (declarantes)', 1000, 350, 12, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (13, 'fees', 'Honorarios y comisiones (personas jurídicas)', 0, 1100, 13, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (14, 'fees', 'Honorarios y comisiones pagados a personas naturales', 0, 1100, 14, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (15, 'services', 'Servicios de licenciamiento o derecho de uso de software', 0, 350, 15, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- Títulos iniciales (normalizados como en el frontend: minúsculas, sin tildes, espacios simples).
INSERT OR IGNORE INTO document_title_mappings (normalized_title, display_title, category, created_at, updated_at) VALUES
    ('factura electronica de venta', 'FACTURA ELECTRÓNICA DE VENTA', 'invoice', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('nota credito electronica', 'NOTA CRÉDITO ELECTRÓNICA', 'credit_note', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
