-- 011: Códigos PUC por factura → códigos usados con cada proveedor. Solo adiciones.
--
-- Cada código que el usuario confirma para una factura o un producto queda
-- asociado al emisor de la factura, y se ofrece como acceso rápido en sus
-- próximas facturas. Nunca se asigna solo.
--   · supplier_nit: NIT del emisor (solo dígitos, sin dígito de verificación),
--     la misma clave que `suppliers.nit`. Se guarda el NIT y no el id para que
--     funcione también con emisores que aún no están en Proveedores (crearlos
--     exige datos de IVA que este módulo no pide) y quede enlazado en cuanto
--     se creen. La razón social no interviene.
--   · puc_code: solo la referencia; el concepto se lee siempre de `puc_codes`.
--   · Un código por proveedor aparece una sola vez: al reutilizarlo se
--     actualizan `last_used_at` y `usage_count`.
CREATE TABLE IF NOT EXISTS supplier_puc_codes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_nit  TEXT NOT NULL CHECK (supplier_nit <> '' AND supplier_nit NOT GLOB '*[^0-9]*'),
    puc_code      TEXT NOT NULL CHECK (length(puc_code) = 6) REFERENCES puc_codes(code),
    usage_count   INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    last_used_at  TEXT NOT NULL,
    UNIQUE (supplier_nit, puc_code)
);
