-- 017: Tabla de Códigos PUC administrable. Solo adiciones.
--
-- El catálogo oficial (puc_codes) sigue intacto: nunca se borra ni se cambia
-- un código oficial. Lo que el usuario ajusta de una cuenta oficial (concepto
-- propio, inactiva) se guarda aparte en puc_official_overrides; sin fila = la
-- denominación del catálogo y activa.
--
-- Inactivo = no se ofrece en nuevas selecciones; los movimientos, mapeos,
-- configuraciones e historial que ya lo usan no cambian.

ALTER TABLE puc_custom_codes ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));

CREATE TABLE IF NOT EXISTS puc_official_overrides (
    code        TEXT PRIMARY KEY REFERENCES puc_codes(code),
    -- NULL = se usa la denominación oficial.
    concept     TEXT CHECK (concept IS NULL OR trim(concept) <> ''),
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_at  TEXT NOT NULL
);

-- Trazabilidad de cada cambio en la tabla (oficiales y personalizados).
--   action: edited | recoded | deactivated | reactivated | deleted
--   previous / next: JSON con los datos antes y después del cambio.
CREATE TABLE IF NOT EXISTS puc_code_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL,
    action      TEXT NOT NULL CHECK (action IN ('edited', 'recoded', 'deactivated', 'reactivated', 'deleted')),
    previous    TEXT NOT NULL DEFAULT '{}',
    next        TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_puc_code_events ON puc_code_events (code);
