-- 033: Compras, costos y exógena — la suma de las líneas se compara con «Total Bruto Factura» (nunca con «Subtotal»). Solo adiciones.
--
-- 1) `purchase_total_decisions`: qué valor eligió el usuario cuando la diferencia supera la tolerancia ($10): usar el Total Bruto
--    Factura, usar la suma de líneas o excluir la factura. Guarda los valores comparados al decidir; si el contenido cambia, la
--    decisión deja de valer y se vuelve a preguntar.
-- 2) `purchase_line_overrides`: corrección de la base de una línea mal leída (el PDF original no se toca; el valor leído se conserva).
-- 3) `purchases.totals_rule_since`: desde cuándo rige la regla. Las facturas con líneas confirmadas antes de esa fecha no se
--    recalculan ni se bloquean solas: cualquier ajuste sobre ellas exige una acción explícita.
-- 4) Trazabilidad de la corrección de regla: las facturas que solo estaban alertadas por compararse con el Subtotal y cuyas
--    líneas sí coinciden con el Total Bruto Factura quedan registradas en la auditoría de Compras.

CREATE TABLE IF NOT EXISTS purchase_total_decisions (
    document_id  INTEGER PRIMARY KEY REFERENCES purchase_documents(id) ON DELETE CASCADE,
    choice       TEXT NOT NULL CHECK (choice IN ('gross', 'lines', 'exclude')),
    lines_cents  INTEGER NOT NULL,
    gross_cents  INTEGER NOT NULL,
    reason       TEXT NOT NULL DEFAULT '',
    decided_by   TEXT NOT NULL DEFAULT '',
    decided_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_line_overrides (
    document_id     INTEGER NOT NULL REFERENCES purchase_documents(id) ON DELETE CASCADE,
    line_index      INTEGER NOT NULL,
    base_cents      INTEGER NOT NULL,
    original_cents  INTEGER,
    reason          TEXT NOT NULL DEFAULT '',
    decided_by      TEXT NOT NULL DEFAULT '',
    decided_at      TEXT NOT NULL,
    PRIMARY KEY (document_id, line_index)
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('purchases.totals_rule_since', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT INTO purchase_audit (buyer_nit, year, event, detail, created_at)
SELECT buyer_nit, year, 'Regla de totales corregida',
       json_object('rule', 'Las líneas se comparan con Total Bruto Factura (antes con Subtotal)', 'effect', 'Se retira la alerta por diferencia contra el Subtotal: las líneas coinciden con el Total Bruto Factura', 'documents', json_group_array(file_name)),
       strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM (
    SELECT d.buyer_nit AS buyer_nit, d.year AS year, d.file_name AS file_name,
           (SELECT SUM(json_extract(l.value, '$.baseCents')) FROM json_each(d.data, '$.lines') l) AS lines_sum,
           json_extract(d.data, '$.subtotalCents') AS subtotal,
           json_extract(d.data, '$.grossTotalCents') AS gross
    FROM purchase_documents d WHERE d.status = 'current'
)
WHERE subtotal IS NOT NULL AND gross IS NOT NULL AND lines_sum IS NOT NULL AND ABS(lines_sum - subtotal) > 100 AND ABS(lines_sum - gross) <= 1000
GROUP BY buyer_nit, year;
