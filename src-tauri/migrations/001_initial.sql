-- 001: esquema inicial.
-- Regla: las migraciones solo AGREGAN (tablas, columnas, índices). Nunca DROP de tablas con datos.

CREATE TABLE IF NOT EXISTS companies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    razon_social    TEXT NOT NULL,
    nit             TEXT NOT NULL,
    direccion       TEXT NOT NULL DEFAULT '',
    ciudad          TEXT NOT NULL DEFAULT '',
    telefono        TEXT NOT NULL DEFAULT '',
    correo          TEXT NOT NULL DEFAULT '',
    info_adicional  TEXT NOT NULL DEFAULT '',
    logo_file       TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companies_razon_social ON companies (razon_social COLLATE NOCASE);

-- tipo_retencion y unidad_tarifa se validan en Rust (sin CHECK) para poder
-- agregar tipos nuevos en el futuro sin reconstruir la tabla.
CREATE TABLE IF NOT EXISTS retention_concepts (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre                  TEXT NOT NULL,
    tipo_retencion          TEXT NOT NULL,
    tarifa_predeterminada   REAL,
    unidad_tarifa           TEXT NOT NULL,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_concepts_nombre ON retention_concepts (nombre COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);
