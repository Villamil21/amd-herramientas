import { useEffect, useState } from "react";
import { fsService } from "../../../../services/fsService";
import { EMPTY_PERIOD_LABEL, type BatchSummary, type EmptyPeriodSource, type Movement } from "../../../../types/fs";
import { coverage } from "../../generator/checks";
import { MONTH_NAMES } from "../money";

interface Props {
  companyId: number | null;
  source: EmptyPeriodSource;
  /** Año a mostrar (enero a diciembre). */
  year: number;
  /** Cambia para volver a leer (p. ej. tras enviar o registrar un periodo sin actividad). */
  refreshKey?: unknown;
}

/**
 * Cobertura compacta de una fuente para un año: ✓ (con información), ✓ Sin …
 * (registrado sin actividad) o — (falta). Usa la misma regla del Generador.
 */
export function SourceCoverage({ companyId, source, year, refreshKey }: Props) {
  const [ledger, setLedger] = useState<{ movements: Movement[]; batches: BatchSummary[] } | null>(null);

  useEffect(() => {
    if (companyId === null) return setLedger(null);
    let alive = true;
    Promise.all([fsService.movements(companyId), fsService.batches(companyId)]).then(
      ([movements, batches]) => alive && setLedger({ movements, batches }),
      () => alive && setLedger(null),
    );
    return () => {
      alive = false;
    };
  }, [companyId, refreshKey]);

  if (companyId === null || !ledger) return null;
  const { months, rows } = coverage(`${year}-01-01`, `${year}-12-31`, ledger.movements, [], ledger.batches);
  const row = rows.find((r) => r.source === source);
  if (!row) return null;
  return (
    <div className="card source-coverage" role="group" aria-label={`Cobertura ${year}`}>
      <span className="source-coverage__title">Cobertura {year}</span>
      <ol className="source-coverage__months">
        {months.map((m) => {
          const c = row.cells[m];
          const label = MONTH_NAMES[Number(m.slice(5, 7)) - 1];
          const state = c.emptyDeclared ? `✓ ${EMPTY_PERIOD_LABEL[source]}` : c.loaded ? "✓" : "—";
          return (
            <li key={m} className={c.loaded ? "is-loaded" : undefined} title={`${label} ${year}: ${c.emptyDeclared ? EMPTY_PERIOD_LABEL[source] : c.loaded ? "con información" : "sin información"}`}>
              <span>{label.slice(0, 3)}</span>
              <strong>{state}</strong>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
