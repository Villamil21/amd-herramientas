import { formatInteger, formatMoneyCents } from "../../../../utils/format";
import { Stat } from "../../shared/components/Stat";
import type { CoopcentralSummary } from "../types";

export function CoopcentralSummaryCards({ summary }: { summary: CoopcentralSummary }) {
  return (
    <div className="stack stack--sm">
      <div className="stat-row">
        <Stat label="Movimientos encontrados" value={formatInteger(summary.movementCount)} />
        <Stat label="Conceptos diferentes" value={formatInteger(summary.conceptCount)} />
        <Stat label="Grupos de créditos" value={formatInteger(summary.creditGroups)} />
        <Stat label="Grupos de débitos" value={formatInteger(summary.debitGroups)} />
      </div>
      <div className="stat-row">
        <Stat label="Total créditos" value={formatMoneyCents(summary.totalCreditsCents)} tone="positive" />
        <Stat label="Total débitos" value={formatMoneyCents(summary.totalDebitsCents)} tone="negative" />
        <Stat label="Neto" value={formatMoneyCents(summary.netCents)} />
      </div>
    </div>
  );
}
