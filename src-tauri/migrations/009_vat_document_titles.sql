-- IVA de compras: clasificación persistente del título de cada documento en
-- una de las dos categorías finales del resumen (Factura electrónica o Nota
-- crédito). Es independiente de la clasificación de Retención en la fuente
-- compras (document_title_mappings): cada módulo guarda la suya.
CREATE TABLE IF NOT EXISTS vat_document_title_mappings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_title  TEXT NOT NULL UNIQUE,
    display_title     TEXT NOT NULL,
    category          TEXT NOT NULL CHECK (category IN ('invoice', 'credit_note')),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

-- Títulos iniciales (normalizados como en el frontend: minúsculas, sin tildes,
-- espacios simples). Solo se crean si faltan; nunca sobrescriben una decisión.
INSERT OR IGNORE INTO vat_document_title_mappings (normalized_title, display_title, category, created_at, updated_at) VALUES
    ('factura electronica de venta', 'FACTURA ELECTRÓNICA DE VENTA', 'invoice', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('factura electronica de mandato', 'FACTURA ELECTRÓNICA DE MANDATO', 'invoice', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('factura de venta de talonario o de papel', 'FACTURA DE VENTA DE TALONARIO O DE PAPEL', 'invoice', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('nota de credito electronica', 'Nota de crédito electrónica', 'credit_note', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('nota credito electronica', 'NOTA CRÉDITO ELECTRÓNICA', 'credit_note', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('nota credito de la factura electronica de venta', 'Nota Crédito de la Factura Electrónica de Venta', 'credit_note', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
