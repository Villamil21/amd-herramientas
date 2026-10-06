-- 012: proveedores con datos mínimos y códigos PUC enlazados al proveedor real.
--
-- 1) Un proveedor puede existir solo con NIT y razón social (por ejemplo,
--    creado desde «Códigos PUC por factura»). El Tipo IVA deja de ser
--    obligatorio: queda en NULL («sin configurar») hasta que IVA de compras lo
--    pida. SQLite no permite quitar NOT NULL a una columna, así que la tabla
--    se reconstruye con el procedimiento oficial: copia completa a la tabla
--    nueva (mismos id, fechas y datos de retención), reemplazo y renombre.
--    Esta migración corre con las llaves foráneas apagadas (ver
--    `rebuilds_tables` en migrations.rs) para que las reglas de retención de
--    cada proveedor no se toquen, y se verifica la integridad antes de confirmar.
CREATE TABLE suppliers_rebuild (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    nit                TEXT NOT NULL UNIQUE,
    business_name      TEXT NOT NULL,
    vat_type           TEXT CHECK (vat_type IN ('purchase', 'service')),
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    person_type        TEXT CHECK (person_type IN ('PJ', 'PN')),
    fiscal_regime      TEXT,
    fiscal_checked_at  TEXT
);
INSERT INTO suppliers_rebuild (id, nit, business_name, vat_type, created_at, updated_at, person_type, fiscal_regime, fiscal_checked_at)
SELECT id, nit, business_name, vat_type, created_at, updated_at, person_type, fiscal_regime, fiscal_checked_at FROM suppliers;
DROP TABLE suppliers;
ALTER TABLE suppliers_rebuild RENAME TO suppliers;
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(business_name COLLATE NOCASE);

-- 2) Los códigos PUC usados con un proveedor se guardan contra su registro
--    (supplier_id) y se van con él si se elimina. La tabla de la 011, que los
--    guardaba por NIT, queda solo como archivo: ya no se escribe en ella. Sus
--    filas pasan aquí si el proveedor existe; las de un NIT sin proveedor se
--    enlazan cuando se cree ese proveedor.
ALTER TABLE supplier_puc_codes RENAME TO supplier_puc_codes_by_nit;
CREATE TABLE supplier_puc_codes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id   INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    puc_code      TEXT NOT NULL CHECK (length(puc_code) = 6) REFERENCES puc_codes(code),
    usage_count   INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    last_used_at  TEXT NOT NULL,
    UNIQUE (supplier_id, puc_code)
);
INSERT INTO supplier_puc_codes (supplier_id, puc_code, usage_count, created_at, last_used_at)
SELECT s.id, l.puc_code, l.usage_count, l.created_at, l.last_used_at
FROM supplier_puc_codes_by_nit l JOIN suppliers s ON s.nit = l.supplier_nit
ORDER BY l.id;
