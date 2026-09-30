import { formatInteger } from "../../../../utils/format";
import { Stat } from "../../../bank-analysis/shared/components/Stat";
import type { WithholdingReport } from "../types";
import type { DocFilter } from "./DocumentsTable";

/** Conciliación del lote. Las tarjetas con filtro llevan a la tabla de documentos. */
export function WithholdingStats({ stats, filter, onFilter }: { stats: WithholdingReport["stats"]; filter: DocFilter; onFilter: (f: DocFilter) => void }) {
  const link = (f: DocFilter) => ({ onClick: () => onFilter(f), active: filter === f, title: "Ver en la tabla de documentos" });
  return (
    <div className="stat-row">
      <Stat label="Documentos encontrados" value={formatInteger(stats.files)} {...link("all")} active={false} />
      <Stat label="Procesados" value={formatInteger(stats.processed)} />
      <Stat label="Validados" value={formatInteger(stats.validated)} tone={stats.validated ? "positive" : undefined} {...link("validated")} />
      <Stat label="Documentos pendientes" value={formatInteger(stats.pending)} tone={stats.pending ? "negative" : undefined} {...link("pending")} />
      <Stat label="No superan tope" value={formatInteger(stats.belowMinimum)} {...link("below")} />
      <Stat label="Ignorados" value={formatInteger(stats.ignored)} {...link("ignored")} />
      <Stat label="Fuera del periodo" value={formatInteger(stats.outOfPeriod)} {...link("ignored")} active={false} />
      <Stat label="Duplicados" value={formatInteger(stats.duplicates)} {...link("ignored")} active={false} />
    </div>
  );
}
