-- 003: proveedores para el análisis de IVA de facturas. Solo adiciones.
-- El NIT (solo dígitos, sin dígito de verificación) es la clave de cruce con las facturas.
CREATE TABLE IF NOT EXISTS suppliers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nit            TEXT NOT NULL UNIQUE,
    business_name  TEXT NOT NULL,
    vat_type       TEXT NOT NULL CHECK (vat_type IN ('purchase', 'service')),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(business_name COLLATE NOCASE);
