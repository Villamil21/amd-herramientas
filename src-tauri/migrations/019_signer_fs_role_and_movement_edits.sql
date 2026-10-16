-- 019: Rol EEFF de las firmas, edición trazable de movimientos y líneas que
-- faltaban en el catálogo inicial de Estados Financieros. Solo adiciones.
--
-- certificate_signers.fs_excluded: 1 = «No usar como contador en EEFF». Con
-- accountant_title vacío y fs_excluded = 0 la firma queda «Pendiente EEFF».
ALTER TABLE certificate_signers ADD COLUMN fs_excluded INTEGER NOT NULL DEFAULT 0 CHECK (fs_excluded IN (0, 1));

-- Cada edición de un movimiento desde «Movimientos contables». El original
-- nunca se sobrescribe: pasa a «adjusted» (o a «ignored» / «voided» si la
-- edición solo cambia el estado) y la versión corregida es un movimiento nuevo
-- del mismo lote (new_movement_id). previous / next: los campos editables antes
-- y después (JSON). reason es obligatorio.
CREATE TABLE IF NOT EXISTS fs_movement_edits (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id            INTEGER NOT NULL REFERENCES companies(id),
    original_movement_id  INTEGER NOT NULL REFERENCES fs_movements(id),
    new_movement_id       INTEGER REFERENCES fs_movements(id),
    reason                TEXT NOT NULL CHECK (trim(reason) <> ''),
    origin                TEXT NOT NULL DEFAULT 'movements',
    previous              TEXT NOT NULL,
    next                  TEXT NOT NULL,
    created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_movement_edits_company ON fs_movement_edits (company_id, original_movement_id);

-- Líneas del catálogo inicial que no estaban en 014. Solo si la sección aún no
-- tiene una línea con ese nombre (el usuario pudo crearla), y al final de la
-- sección: el orden que el usuario ya definió no cambia.
INSERT INTO fs_lines (section, name, sort_order, role, created_at, updated_at)
    SELECT 'asset_current', 'Deudores', COALESCE((SELECT MAX(sort_order) FROM fs_lines WHERE section = 'asset_current'), 0) + 1, NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE NOT EXISTS (SELECT 1 FROM fs_lines WHERE section = 'asset_current' AND lower(trim(name)) = lower('Deudores'));
INSERT INTO fs_lines (section, name, sort_order, role, created_at, updated_at)
    SELECT 'asset_noncurrent', 'Deudores', COALESCE((SELECT MAX(sort_order) FROM fs_lines WHERE section = 'asset_noncurrent'), 0) + 1, NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE NOT EXISTS (SELECT 1 FROM fs_lines WHERE section = 'asset_noncurrent' AND lower(trim(name)) = lower('Deudores'));
INSERT INTO fs_lines (section, name, sort_order, role, created_at, updated_at)
    SELECT 'liability_noncurrent', 'Impuestos, gravámenes y tasas', COALESCE((SELECT MAX(sort_order) FROM fs_lines WHERE section = 'liability_noncurrent'), 0) + 1, NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE NOT EXISTS (SELECT 1 FROM fs_lines WHERE section = 'liability_noncurrent' AND lower(trim(name)) = lower('Impuestos, gravámenes y tasas'));
INSERT INTO fs_lines (section, name, sort_order, role, created_at, updated_at)
    SELECT 'admin_expenses', 'Seguros', COALESCE((SELECT MAX(sort_order) FROM fs_lines WHERE section = 'admin_expenses'), 0) + 1, NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE NOT EXISTS (SELECT 1 FROM fs_lines WHERE section = 'admin_expenses' AND lower(trim(name)) = lower('Seguros'));
INSERT INTO fs_lines (section, name, sort_order, role, created_at, updated_at)
    SELECT 'admin_expenses', 'Mantenimiento y reparaciones', COALESCE((SELECT MAX(sort_order) FROM fs_lines WHERE section = 'admin_expenses'), 0) + 1, NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE NOT EXISTS (SELECT 1 FROM fs_lines WHERE section = 'admin_expenses' AND lower(trim(name)) = lower('Mantenimiento y reparaciones'));
INSERT INTO fs_lines (section, name, sort_order, role, created_at, updated_at)
    SELECT 'admin_expenses', 'Adecuación e instalación', COALESCE((SELECT MAX(sort_order) FROM fs_lines WHERE section = 'admin_expenses'), 0) + 1, NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE NOT EXISTS (SELECT 1 FROM fs_lines WHERE section = 'admin_expenses' AND lower(trim(name)) = lower('Adecuación e instalación'));
INSERT INTO fs_lines (section, name, sort_order, role, created_at, updated_at)
    SELECT 'admin_expenses', 'Gastos de viaje', COALESCE((SELECT MAX(sort_order) FROM fs_lines WHERE section = 'admin_expenses'), 0) + 1, NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE NOT EXISTS (SELECT 1 FROM fs_lines WHERE section = 'admin_expenses' AND lower(trim(name)) = lower('Gastos de viaje'));
