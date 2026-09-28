import { formatInteger, formatMoneyCents } from "../../../../utils/format";
import type { StatementSummary } from "../types";
import { Stat } from "./Stat";

export function SummaryCards({ summary }: { summary: StatementSummary }) {
  return (
    <div className="stack stack--sm">
      <div className="stat-row">
        <Stat label="Movimientos encontrados" value={formatInteger(summary.movementCount)} />
        <Stat label="Conceptos diferentes" value={formatInteger(summary.conceptCount)} />
        <Stat label="Grupos positivos" value={formatInteger(summary.positiveGroups)} />
        <Stat label="Grupos negativos" value={formatInteger(summary.negativeGroups)} />
      </div>
      <div className="stat-row">
        <Stat label="Total positivo" value={formatMoneyCents(summary.totalPositiveCents)} tone="positive" />
        <Stat label="Total negativo" value={formatMoneyCents(summary.totalNegativeCents)} tone="negative" />
        <Stat label="Neto" value={formatMoneyCents(summary.netCents)} />
      </div>
    </div>
  );
}
