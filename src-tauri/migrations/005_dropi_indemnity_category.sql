-- 005: nueva clasificación configurable "indemnity" (Indemnización) para los
-- estados de Dropi. SQLite no permite cambiar un CHECK: se crea la tabla con la
-- restricción ampliada y se copian todas las reglas (mismos id y fechas).
-- La tabla anterior se conserva renombrada como respaldo (no se borra nada).
ALTER TABLE dropi_status_mappings RENAME TO dropi_status_mappings_004;

CREATE TABLE dropi_status_mappings (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_status  TEXT NOT NULL UNIQUE,
    display_status     TEXT NOT NULL,
    category           TEXT NOT NULL CHECK (category IN ('in_process', 'claim', 'indemnity')),
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

INSERT INTO dropi_status_mappings (id, normalized_status, display_status, category, created_at, updated_at)
SELECT id, normalized_status, display_status, category, created_at, updated_at FROM dropi_status_mappings_004;
