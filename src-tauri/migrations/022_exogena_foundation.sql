-- 022: Información Exógena (fase 1). Solo adiciones.
--
-- 1) Terceros (proveedores): datos tributarios y territoriales para reportar en Exógena.
--    El NIT/documento del tercero sigue siendo `suppliers.nit` (solo dígitos, sin DV): es la clave
--    de cruce con las facturas y no se duplica. Aquí se agregan el tipo de documento DIAN, el DV
--    y el resto de los datos. `person_type` (PJ/PN) ya existía.
-- 2) Catálogos Exógena (tipos de documento DIAN, países, departamentos, municipios). Los datos
--    de sistema los siembra la migración 023; los ajustes del usuario quedan en `exo_catalog_audit`.
-- 3) Socios: ficha ampliada (identificación, ubicación, contacto) y RUT del socio con historial.
-- 4) Estado anual por formato y registros de cada formato (1010, 1009 y los que vengan).

-- ---------------------------------------------------------------------------
-- 1. Terceros
-- ---------------------------------------------------------------------------
ALTER TABLE suppliers ADD COLUMN doc_type_code TEXT;
ALTER TABLE suppliers ADD COLUMN dv TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN first_surname TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN second_surname TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN other_names TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN country_code TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN country_name TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN dept_code TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN dept_name TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN muni_code TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN muni_name TEXT NOT NULL DEFAULT '';
-- De dónde salieron los datos (manual, factura, rut, empresas) y cuándo se verificaron.
ALTER TABLE suppliers ADD COLUMN data_origin TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN data_verified_at TEXT;
-- Lo calcula Rust al guardar con las mismas reglas que el formulario.
ALTER TABLE suppliers ADD COLUMN data_status TEXT NOT NULL DEFAULT 'requiere_datos' CHECK (data_status IN ('completo', 'requiere_datos'));
CREATE INDEX IF NOT EXISTS idx_suppliers_data_status ON suppliers (data_status);

-- ---------------------------------------------------------------------------
-- 2. Catálogos Exógena
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exo_catalog_meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exo_document_types (
    code         TEXT PRIMARY KEY CHECK (length(code) = 2 AND code NOT GLOB '*[^0-9]*'),
    description  TEXT NOT NULL CHECK (trim(description) <> ''),
    is_system    INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exo_countries (
    code        TEXT PRIMARY KEY CHECK (length(code) = 3 AND code NOT GLOB '*[^0-9]*'),
    name        TEXT NOT NULL CHECK (trim(name) <> ''),
    is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exo_departments (
    code        TEXT PRIMARY KEY CHECK (length(code) = 2 AND code NOT GLOB '*[^0-9]*'),
    name        TEXT NOT NULL CHECK (trim(name) <> ''),
    is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_at  TEXT NOT NULL
);

-- El código de municipio son 3 dígitos DENTRO del departamento («76001» = departamento 76, municipio 001).
CREATE TABLE IF NOT EXISTS exo_municipalities (
    dept_code   TEXT NOT NULL REFERENCES exo_departments(code),
    code        TEXT NOT NULL CHECK (length(code) = 3 AND code NOT GLOB '*[^0-9]*'),
    name        TEXT NOT NULL CHECK (trim(name) <> ''),
    is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (dept_code, code)
);

-- Trazabilidad de cada ajuste del usuario a un catálogo (los valores de sistema nunca se eliminan).
CREATE TABLE IF NOT EXISTS exo_catalog_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    catalog     TEXT NOT NULL CHECK (catalog IN ('document_types', 'countries', 'departments', 'municipalities')),
    code        TEXT NOT NULL,
    action      TEXT NOT NULL CHECK (action IN ('add', 'rename', 'activate', 'deactivate', 'delete')),
    old_value   TEXT NOT NULL DEFAULT '',
    new_value   TEXT NOT NULL DEFAULT '',
    changed_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 3. Socios
-- ---------------------------------------------------------------------------
-- `identity_document` sigue siendo el documento «tal como se muestra» (ej. «CC 1192729629»), que usan
-- los certificados y el representante legal. Los campos nuevos alimentan Exógena.
ALTER TABLE shareholders ADD COLUMN doc_type_code TEXT;
ALTER TABLE shareholders ADD COLUMN dv TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN person_type TEXT CHECK (person_type IS NULL OR person_type IN ('PJ', 'PN'));
ALTER TABLE shareholders ADD COLUMN first_surname TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN second_surname TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN other_names TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN country_code TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN country_name TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN dept_code TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN dept_name TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN muni_code TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN muni_name TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE shareholders ADD COLUMN email TEXT NOT NULL DEFAULT '';
-- pendiente: sin RUT importado · validado: el usuario confirmó los datos del RUT · revisar: hay diferencias por resolver.
ALTER TABLE shareholders ADD COLUMN rut_status TEXT NOT NULL DEFAULT 'pendiente' CHECK (rut_status IN ('pendiente', 'validado', 'revisar'));

-- Historial del RUT de cada socio (misma mecánica que company_documents: cada carga es una versión nueva).
-- El PDF vive en <datos>/company_documents con un nombre generado por la app.
CREATE TABLE IF NOT EXISTS shareholder_documents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shareholder_id  INTEGER NOT NULL REFERENCES shareholders(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL DEFAULT 'rut' CHECK (kind = 'rut'),
    file_name       TEXT NOT NULL CHECK (trim(file_name) <> ''),
    stored_file     TEXT NOT NULL UNIQUE,
    size_bytes      INTEGER NOT NULL CHECK (size_bytes > 0),
    uploaded_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shareholder_documents_shareholder ON shareholder_documents (shareholder_id, uploaded_at);

-- ---------------------------------------------------------------------------
-- 4. Información Exógena: estado anual por formato y registros
-- ---------------------------------------------------------------------------
-- Un formato por empresa y año. «listo» lo decide el frontend con las reglas del formato; «no_aplica»
-- exige una justificación (se valida también en Rust).
CREATE TABLE IF NOT EXISTS exo_format_status (
    company_id              INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    year                    INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    format_code             TEXT NOT NULL CHECK (format_code <> '' AND format_code NOT GLOB '*[^0-9]*'),
    status                  TEXT NOT NULL DEFAULT 'en_preparacion' CHECK (status IN ('en_preparacion', 'listo', 'requiere_actualizacion', 'no_aplica')),
    not_applicable_reason   TEXT NOT NULL DEFAULT '',
    last_synced_at          TEXT,
    -- Huella de los datos de origen cuando se sincronizó (1010: socios y capital de Empresas).
    source_fingerprint      TEXT NOT NULL DEFAULT '',
    updated_at              TEXT NOT NULL,
    PRIMARY KEY (company_id, year, format_code)
);

-- Un registro de un formato. `data` es JSON con las columnas del formato; `manual_fields` lista las que el usuario
-- corrigió en Exógena (una nueva sincronización no las reemplaza sin confirmación). `source_key` identifica el origen
-- de forma idempotente (ej. «shareholder:12», «proveedor:7|2201»): sincronizar dos veces no duplica.
CREATE TABLE IF NOT EXISTS exo_records (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id            INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    year                  INTEGER NOT NULL,
    format_code           TEXT NOT NULL,
    source_key            TEXT NOT NULL CHECK (trim(source_key) <> ''),
    origin                TEXT NOT NULL CHECK (origin IN ('empresas', 'estados_financieros', 'manual')),
    origin_ref            TEXT NOT NULL DEFAULT '',
    data                  TEXT NOT NULL DEFAULT '{}',
    manual_fields         TEXT NOT NULL DEFAULT '[]',
    manually_modified_at  TEXT,
    synced_at             TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    UNIQUE (company_id, year, format_code, source_key)
);
CREATE INDEX IF NOT EXISTS idx_exo_records_format ON exo_records (company_id, year, format_code);

-- Bitácora de sincronizaciones: qué fuentes se leyeron y qué cambió.
CREATE TABLE IF NOT EXISTS exo_sync_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    year         INTEGER NOT NULL,
    format_code  TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT '',
    ran_at       TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_exo_sync_runs_format ON exo_sync_runs (company_id, year, format_code, ran_at);
