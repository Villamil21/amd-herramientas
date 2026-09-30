-- 007: Certificado de ingresos. Solo adiciones.
-- Identificación personal del firmante (ej. "CC 1.192.729.629"); opcional.
ALTER TABLE certificate_signers ADD COLUMN personal_document TEXT NOT NULL DEFAULT '';

-- Tipos de documento de identidad del titular. Los de sistema no se pueden eliminar.
-- is_numeric = 1: el número se muestra con separador de miles (1.006.011.707).
CREATE TABLE IF NOT EXISTS identity_document_types (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    is_numeric  INTEGER NOT NULL DEFAULT 1 CHECK (is_numeric IN (0, 1)),
    is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

INSERT OR IGNORE INTO identity_document_types (id, name, is_numeric, is_system, created_at, updated_at) VALUES
    (1, 'Cédula de Ciudadanía', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    (2, 'Cédula de Extranjería', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
