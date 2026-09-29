import { formatInteger, formatMoneyCents } from "../../../../utils/format";
import type { StatementSummary } from "../types";
import { Stat } from "./Stat";

/**
 * finalBalanceCents: saldo final impreso en el extracto (SALDO ACTUAL, Nuevo
 * saldo…), no el neto. Obligatorio para que todo banco nuevo lo muestre;
 * undefined si el PDF no lo trae.
 */
export function SummaryCards({ summary, finalBalanceCents }: { summary: StatementSummary; finalBalanceCents: number | undefined }) {
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
        <Stat label="Saldo final" value={finalBalanceCents === undefined ? "—" : formatMoneyCents(finalBalanceCents)} />
      </div>
    </div>
  );
}
