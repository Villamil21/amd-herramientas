-- SMMLV (salario mínimo mensual legal vigente) por año: dato maestro editable,
-- reutilizable por cualquier módulo (hoy, Calculadoras → aportes de
-- independientes). Pesos enteros. Nunca se actualiza desde Internet.
CREATE TABLE IF NOT EXISTS minimum_wages (
    year        INTEGER PRIMARY KEY CHECK (year BETWEEN 2000 AND 2100),
    value_pesos INTEGER NOT NULL CHECK (value_pesos > 0),
    updated_at  TEXT NOT NULL
);

-- Valor inicial editable (solo se crea si falta; nunca sobrescribe).
INSERT OR IGNORE INTO minimum_wages (year, value_pesos, updated_at) VALUES (2026, 1750905, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
