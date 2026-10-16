-- 025: Obligaciones tributarias — excedentes de pago y decisiones de revisión. Solo adiciones.
--
-- Un pago puede superar el saldo pendiente de la obligación. amount_cents sigue siendo lo APLICADO a la obligación
-- (nunca supera el saldo) y lo que sobra queda en excess_cents con su clasificación:
--   · 'interest': interés (gasto, PUC propio; no genera deudores ni 1008).
--   · 'favor': excedente a favor de la DIAN (candidato a deudor; su inclusión en EEFF y 1008 requiere aprobación).
-- Los pagos existentes quedan sin excedente.
ALTER TABLE fs_tax_payments ADD COLUMN excess_cents INTEGER NOT NULL DEFAULT 0 CHECK (excess_cents >= 0);
ALTER TABLE fs_tax_payments ADD COLUMN excess_kind TEXT NOT NULL DEFAULT '' CHECK (excess_kind IN ('', 'interest', 'favor'));

-- Decisión del usuario sobre un excedente a favor al preparar EEFF / sincronizar Exógena:
--   applies      → entra a EEFF (deudor) y al 1008 (DIAN-1317) a la vez.
--   not_applies  → sale de ambos. El pago original nunca se elimina.
-- fingerprint: huella del pago, clasificación, PUC y valor al decidir; si cambia, la decisión deja de valer y se vuelve a preguntar.
CREATE TABLE IF NOT EXISTS fs_tax_excess_reviews (
    payment_id   INTEGER PRIMARY KEY REFERENCES fs_tax_payments(id),
    decision     TEXT NOT NULL CHECK (decision IN ('applies', 'not_applies')),
    fingerprint  TEXT NOT NULL,
    decided_at   TEXT NOT NULL
);
