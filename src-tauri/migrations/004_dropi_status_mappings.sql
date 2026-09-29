-- 004: clasificación de estados de Dropi (módulo Dropi → Órdenes). Solo adiciones.
-- Global al módulo (no por empresa). Los estados con regla fija no se guardan aquí.
CREATE TABLE IF NOT EXISTS dropi_status_mappings (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_status  TEXT NOT NULL UNIQUE,
    display_status     TEXT NOT NULL,
    category           TEXT NOT NULL CHECK (category IN ('in_process', 'claim')),
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);
