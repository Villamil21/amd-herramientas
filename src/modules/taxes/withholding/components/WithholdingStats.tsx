import { formatInteger } from "../../../../utils/format";
import { Stat } from "../../../bank-analysis/shared/components/Stat";
import type { WithholdingReport } from "../types";

/** Conciliación del lote. */
export function WithholdingStats({ stats }: { stats: WithholdingReport["stats"] }) {
  return (
    <div className="stat-row">
      <Stat label="Documentos encontrados" value={formatInteger(stats.files)} />
      <Stat label="Procesados" value={formatInteger(stats.processed)} />
      <Stat label="Validados" value={formatInteger(stats.validated)} tone={stats.validated ? "positive" : undefined} />
      <Stat label="Pendientes" value={formatInteger(stats.pending)} tone={stats.pending ? "negative" : undefined} />
      <Stat label="No superan tope" value={formatInteger(stats.belowMinimum)} />
      <Stat label="Ignorados" value={formatInteger(stats.ignored)} />
      <Stat label="Fuera del periodo" value={formatInteger(stats.outOfPeriod)} />
      <Stat label="Duplicados" value={formatInteger(stats.duplicates)} />
    </div>
  );
}
