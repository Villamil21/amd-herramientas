-- 018: Obligaciones tributarias → pagos parciales. Solo adiciones.
--
-- Una declaración con saldo a pagar puede tener 0, 1 o varios pagos (incluso
-- varios el mismo día). El valor de la declaración nunca cambia: el saldo
-- pendiente a una fecha de corte = saldo a pagar − pagos con fecha ≤ corte.
-- La suma de los pagos nunca supera el saldo a pagar (se valida en Rust).
--
-- fs_tax_returns.payment_date queda solo como dato heredado: ya no se lee ni
-- se escribe. Cada fecha de pago existente pasa a ser UN pago por el saldo a
-- pagar completo (lo que significaba antes: la obligación quedó pagada ese día).
CREATE TABLE IF NOT EXISTS fs_tax_payments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id     INTEGER NOT NULL REFERENCES fs_tax_returns(id),
    payment_date  TEXT NOT NULL CHECK (payment_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
    note          TEXT NOT NULL DEFAULT '',
    reference     TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_tax_payments_return ON fs_tax_payments (return_id, payment_date);

INSERT INTO fs_tax_payments (return_id, payment_date, amount_cents, note, created_at, updated_at)
SELECT t.id, t.payment_date, t.payable_cents, 'Fecha de pago registrada antes de los pagos parciales', t.updated_at, t.updated_at
FROM fs_tax_returns t
WHERE t.payment_date IS NOT NULL
  AND t.payable_cents > 0
  AND t.resolution <> 'favor'
  AND NOT EXISTS (SELECT 1 FROM fs_tax_payments p WHERE p.return_id = t.id);
