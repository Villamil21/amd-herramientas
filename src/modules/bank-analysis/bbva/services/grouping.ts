import type { SortDirection } from "../../shared/components/tableControls";
import { normalizeDescription } from "../../shared/groupingService";
import { TYPE_ORDER } from "../../shared/types";
import type { BbvaGroup, BbvaMovement, BbvaSummary } from "../types";

/**
 * Agrupación ESTRICTA por Concepto exacto + tipo (abono o cargo). Un mismo
 * concepto con abonos y cargos produce dos grupos: nunca se netean. Sin
 * coincidencias aproximadas; solo se normalizan espacios.
 */
export function groupBbvaMovements(movements: BbvaMovement[]): BbvaGroup[] {
  const groups = new Map<string, BbvaGroup>();
  for (const m of movements) {
    const concept = normalizeDescription(m.concept);
    const key = `${concept}|${m.transactionType}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, concept, transactionType: m.transactionType, count: 0, totalCents: 0, movements: [] };
      groups.set(key, group);
    }
    group.movements.push(m);
    group.count += 1;
    group.totalCents += m.amountCents;
  }
  return sortBbvaGroups([...groups.values()], "concept", "asc");
}

export type BbvaSortKey = "concept" | "type" | "count" | "total";

const collator = new Intl.Collator("es", { sensitivity: "variant", numeric: true });

/** Orden por el criterio elegido y, en empate, concepto y luego tipo (abono antes que cargo). */
export function sortBbvaGroups(groups: BbvaGroup[], key: BbvaSortKey, direction: SortDirection): BbvaGroup[] {
  const dir = direction === "asc" ? 1 : -1;
  const byType = (a: BbvaGroup, b: BbvaGroup) => TYPE_ORDER[a.transactionType] - TYPE_ORDER[b.transactionType];
  const byConcept = (a: BbvaGroup, b: BbvaGroup) => collator.compare(a.concept, b.concept) || byType(a, b);
  return [...groups].sort((a, b) => {
    const primary = key === "concept" ? collator.compare(a.concept, b.concept) : key === "type" ? byType(a, b) : key === "count" ? a.count - b.count : a.totalCents - b.totalCents;
    return dir * primary || byConcept(a, b);
  });
}

export function summarizeBbva(movements: BbvaMovement[], groups: BbvaGroup[]): BbvaSummary {
  let totalCreditsCents = 0;
  let totalChargesCents = 0;
  for (const m of movements) {
    totalCreditsCents += m.creditCents;
    totalChargesCents += m.chargeCents;
  }
  return {
    movementCount: movements.length,
    conceptCount: new Set(groups.map((g) => g.concept)).size,
    creditGroups: groups.filter((g) => g.transactionType === "credit").length,
    chargeGroups: groups.filter((g) => g.transactionType === "debit").length,
    totalCreditsCents,
    totalChargesCents,
    netCents: totalCreditsCents - totalChargesCents,
  };
}
