import type { BankMovement, MovementGroup, StatementSummary } from "./types";

export function summarize(movements: BankMovement[], groups: MovementGroup[]): StatementSummary {
  let totalPositiveCents = 0;
  let totalNegativeCents = 0;
  for (const m of movements) {
    if (m.valueCents > 0) totalPositiveCents += m.valueCents;
    else if (m.valueCents < 0) totalNegativeCents += m.valueCents; // conserva el signo
  }
  return {
    movementCount: movements.length,
    // Descripciones únicas sin considerar el signo.
    conceptCount: new Set(groups.map((g) => g.description)).size,
    positiveGroups: groups.filter((g) => g.sign === "positive").length,
    negativeGroups: groups.filter((g) => g.sign === "negative").length,
    zeroGroups: groups.filter((g) => g.sign === "zero").length,
    totalPositiveCents,
    totalNegativeCents,
    netCents: totalPositiveCents + totalNegativeCents,
  };
}
