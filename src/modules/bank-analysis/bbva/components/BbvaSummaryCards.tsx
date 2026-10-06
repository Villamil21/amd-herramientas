import { formatInteger, formatMoneyCents } from "../../../../utils/format";
import { Stat } from "../../shared/components/Stat";
import type { BbvaSummary } from "../types";

/** finalBalanceCents: SALDO FINAL impreso en el extracto (no el neto); undefined si el PDF no lo trae. */
export function BbvaSummaryCards({ summary, finalBalanceCents }: { summary: BbvaSummary; finalBalanceCents: number | undefined }) {
  return (
    <div className="stack stack--sm">
      <div className="stat-row">
        <Stat label="Movimientos encontrados" value={formatInteger(summary.movementCount)} />
        <Stat label="Conceptos diferentes" value={formatInteger(summary.conceptCount)} />
        <Stat label="Grupos de abonos" value={formatInteger(summary.creditGroups)} />
        <Stat label="Grupos de cargos" value={formatInteger(summary.chargeGroups)} />
      </div>
      <div className="stat-row">
        <Stat label="Total abonos" value={formatMoneyCents(summary.totalCreditsCents)} tone="positive" />
        <Stat label="Total cargos" value={formatMoneyCents(summary.totalChargesCents)} tone="negative" />
        <Stat label="Neto" value={formatMoneyCents(summary.netCents)} />
        <Stat label="Saldo final" value={finalBalanceCents === undefined ? "—" : formatMoneyCents(finalBalanceCents)} />
      </div>
    </div>
  );
}
