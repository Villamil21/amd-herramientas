-- 026: Estados Financieros → Transacciones Cripto → Reporte de operaciones. Solo adiciones.
--
-- Cargas acumulativas de Excel (hojas «Compras» y «Ventas») por empresa y año. Lo que se guarda es el ORIGEN (filas tal como
-- llegaron, con su archivo y su fila): Estados Financieros, el 1007 y el 1647 se recalculan siempre desde aquí, nunca se
-- guardan resultados calculados como fuente de verdad.

-- Una carga = un archivo (el nombre exacto es su identidad dentro de la empresa y el año). Volver a importar el mismo nombre
-- NO crea otra carga: sube `version` y reemplaza sus filas tras la confirmación del usuario.
CREATE TABLE IF NOT EXISTS crypto_uploads (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    year               INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    file_name          TEXT NOT NULL CHECK (trim(file_name) <> ''),
    version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    -- active: alimenta los cálculos · retired: el usuario la retiró (se conserva para auditoría, no alimenta nada).
    status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    -- Hojas leídas del libro (JSON: ["Compras","Ventas"]).
    sheets             TEXT NOT NULL DEFAULT '[]',
    -- Ajuste manual del período que cubre la carga (JSON: ["2026-01","2026-02"]); NULL = el derivado de Compras.Fecha.
    coverage_override  TEXT,
    imported_at        TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    UNIQUE (company_id, year, file_name)
);
CREATE INDEX IF NOT EXISTS idx_crypto_uploads_company ON crypto_uploads (company_id, year);

-- Historial de versiones de cada carga (qué cambió en cada reemplazo).
CREATE TABLE IF NOT EXISTS crypto_upload_versions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id    INTEGER NOT NULL REFERENCES crypto_uploads(id) ON DELETE CASCADE,
    version      INTEGER NOT NULL,
    imported_at  TEXT NOT NULL,
    rows_total   INTEGER NOT NULL DEFAULT 0,
    -- Resumen del cambio frente a la versión anterior (JSON: agregadas, modificadas, sin cambios, eliminadas).
    summary      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_crypto_upload_versions ON crypto_upload_versions (upload_id);

-- Filas de origen. `data` conserva los valores originales por nombre de encabezado (JSON); `fingerprint` es la huella de su
-- contenido material: dos filas con la misma huella son materialmente idénticas.
CREATE TABLE IF NOT EXISTS crypto_rows (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id    INTEGER NOT NULL REFERENCES crypto_uploads(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('purchase', 'sale')),
    sheet        TEXT NOT NULL,
    row_number   INTEGER NOT NULL CHECK (row_number >= 1),
    fingerprint  TEXT NOT NULL,
    data         TEXT NOT NULL DEFAULT '{}',
    UNIQUE (upload_id, kind, row_number)
);
CREATE INDEX IF NOT EXISTS idx_crypto_rows_upload ON crypto_rows (upload_id);

-- Decisiones del usuario sobre una empresa y un año, de varias clases:
--   duplicate  → clave = identidad de la fila (archivo|tipo|huella|ocurrencia); valor 'keep' (Conservar ambos) o 'exclude' (Excluir esta fila).
--   row_exclude→ fila fuera del año o con fecha inválida que el usuario excluyó.
--   assignment → clave = tercero de Compras (1647); valor = pagador de Ventas elegido a mano.
--   city       → clave = tercero; valor = código de municipio elegido entre varias ciudades.
--   country    → clave = tercero; valor = código de país confirmado a mano.
--   setting    → corte de EEFF, tipo de presentación…
-- `fingerprint` ata la decisión al contenido: si la fila de origen cambia, la decisión deja de valer y se vuelve a preguntar.
CREATE TABLE IF NOT EXISTS crypto_decisions (
    company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    year         INTEGER NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('duplicate', 'row_exclude', 'assignment', 'city', 'country', 'setting')),
    key          TEXT NOT NULL CHECK (trim(key) <> ''),
    value        TEXT NOT NULL,
    fingerprint  TEXT NOT NULL DEFAULT '',
    decided_at   TEXT NOT NULL,
    PRIMARY KEY (company_id, year, kind, key)
);

-- Homologaciones persistentes, globales (valen para todas las empresas):
--   document → valor original del tipo de documento (normalizado) → código DIAN.
--   city     → texto de ciudad (normalizado) → código DANE de 5 dígitos.
CREATE TABLE IF NOT EXISTS crypto_homologations (
    kind        TEXT NOT NULL CHECK (kind IN ('document', 'city')),
    source_key  TEXT NOT NULL CHECK (trim(source_key) <> ''),
    value       TEXT NOT NULL CHECK (trim(value) <> ''),
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (kind, source_key)
);

-- Auditoría: importaciones, reemplazos, decisiones y reasignaciones.
CREATE TABLE IF NOT EXISTS crypto_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    year        INTEGER NOT NULL,
    event       TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crypto_audit_company ON crypto_audit (company_id, year);
