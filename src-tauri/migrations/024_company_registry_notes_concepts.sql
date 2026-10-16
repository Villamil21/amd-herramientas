-- 024: Rediseño de Empresas, Notas Financieras y Exógena 1008. Solo adiciones: las empresas, socios, documentos
-- y selecciones existentes abren igual, sin reingreso de datos.
--
-- 1) Datos registrales de la Cámara de Comercio (siempre editables; alimentan el encabezado y las notas de carácter
--    general de Notas Financieras). `registral_review` lista (JSON) los campos que la lectura del certificado no
--    pudo confirmar con certeza y que el usuario debe revisar.
ALTER TABLE companies ADD COLUMN entity_narrative TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN corporate_purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN registry_chamber TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN registry_city TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN constitution_doc_type TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN constitution_date TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN registry_number TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN registry_date TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN registry_book TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN registral_review TEXT NOT NULL DEFAULT '[]';

-- 2) Conceptos por formato de Exógena (reutilizable). Los de sistema no se eliminan (solo se desactivan); los que
--    crea el usuario son exclusivos de su formato. Los registros ya creados conservan su código y descripción.
CREATE TABLE IF NOT EXISTS exo_format_concepts (
    format_code  TEXT NOT NULL CHECK (format_code <> '' AND format_code NOT GLOB '*[^0-9]*'),
    code         TEXT NOT NULL CHECK (trim(code) <> ''),
    description  TEXT NOT NULL CHECK (trim(description) <> ''),
    is_system    INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (format_code, code)
);
INSERT OR IGNORE INTO exo_format_concepts (format_code, code, description, is_system, is_active, updated_at) VALUES
    ('1008', '1315', 'Saldo de las cuentas por cobrar a clientes', 1, 1, '2026-10-16T00:00:00Z'),
    ('1008', '1316', 'Saldo de las cuentas por cobrar a accionistas, socios, comuneros, cooperados y compañías vinculadas', 1, 1, '2026-10-16T00:00:00Z'),
    ('1008', '1317', 'Otras cuentas por cobrar', 1, 1, '2026-10-16T00:00:00Z'),
    ('1008', '1318', 'Valor total del saldo fiscal del deterioro de cartera, identificándolo con el NIT del deudor', 1, 1, '2026-10-16T00:00:00Z');

-- 3) Notas Financieras por empresa y período (el mismo de los Estados Financieros). `data` es el contenido editable
--    (ente económico, objeto social y notas específicas); `company_snapshot` es la instantánea de los datos de Empresas
--    tomada al guardar / generar, para reproducir un PDF histórico, con `company_id` como referencia al origen.
CREATE TABLE IF NOT EXISTS fs_notes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    period_start      TEXT NOT NULL,
    period_end        TEXT NOT NULL,
    data              TEXT NOT NULL DEFAULT '{}',
    company_snapshot  TEXT NOT NULL DEFAULT '{}',
    generated_at      TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    UNIQUE (company_id, period_start, period_end)
);
