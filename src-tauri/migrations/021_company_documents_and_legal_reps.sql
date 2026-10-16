-- 021: Empresas — documentos RUT / Cámara de Comercio con historial y representantes legales.
-- Solo adiciones: las empresas y respaldos anteriores siguen siendo válidos.
--
-- Representante legal principal y suplente: el vínculo vive en el socio
-- (shareholders.legal_role), así no se duplican nombre y documento. Los campos
-- legal_rep_name / legal_rep_document siguen siendo la copia que leen los
-- Estados Financieros (firmante). Sin socio vinculado, el dato solo es válido si
-- el usuario lo confirmó como excepción (legal_rep_manual / legal_rep_alt_manual).
ALTER TABLE companies ADD COLUMN legal_rep_alt_name TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN legal_rep_alt_document TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN legal_rep_manual INTEGER NOT NULL DEFAULT 0 CHECK (legal_rep_manual IN (0, 1));
ALTER TABLE companies ADD COLUMN legal_rep_alt_manual INTEGER NOT NULL DEFAULT 0 CHECK (legal_rep_alt_manual IN (0, 1));

ALTER TABLE shareholders ADD COLUMN legal_role TEXT CHECK (legal_role IS NULL OR legal_role IN ('principal', 'alternate'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_shareholders_legal_role
    ON shareholders (company_id, legal_role) WHERE legal_role IS NOT NULL;

-- Cada carga es una versión nueva; la vigente de cada tipo es la más reciente.
-- stored_file: nombre generado por la app dentro de <datos>/company_documents.
CREATE TABLE IF NOT EXISTS company_documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('rut', 'camara')),
    file_name     TEXT NOT NULL CHECK (trim(file_name) <> ''),
    stored_file   TEXT NOT NULL UNIQUE,
    size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
    uploaded_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_company_documents_company ON company_documents (company_id, kind, uploaded_at);
