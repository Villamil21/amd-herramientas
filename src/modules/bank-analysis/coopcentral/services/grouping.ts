import { normalizeDescription } from "../../shared/groupingService";
import type { SortDirection } from "../../shared/components/tableControls";
import { TYPE_ORDER, type CoopcentralGroup, type CoopcentralMovement, type CoopcentralSummary } from "../types";

/**
 * Agrupación ESTRICTA por CONCEPTO exacto + tipo (crédito o débito). Un mismo
 * concepto con créditos y débitos produce dos grupos: nunca se netean. Sin
 * coincidencias aproximadas; solo se normalizan espacios.
 */
export function groupCoopcentralMovements(movements: CoopcentralMovement[]): CoopcentralGroup[] {
  const groups = new Map<string, CoopcentralGroup>();
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
  return sortCoopcentralGroups([...groups.values()], "concept", "asc");
}

export type CoopcentralSortKey = "concept" | "type" | "count" | "total";

const collator = new Intl.Collator("es", { sensitivity: "variant", numeric: true });

/** Orden por el criterio elegido y, en empate, concepto y luego tipo (crédito antes que débito). */
export function sortCoopcentralGroups(groups: CoopcentralGroup[], key: CoopcentralSortKey, direction: SortDirection): CoopcentralGroup[] {
  const dir = direction === "asc" ? 1 : -1;
  const byType = (a: CoopcentralGroup, b: CoopcentralGroup) => TYPE_ORDER[a.transactionType] - TYPE_ORDER[b.transactionType];
  const byConcept = (a: CoopcentralGroup, b: CoopcentralGroup) => collator.compare(a.concept, b.concept) || byType(a, b);
  return [...groups].sort((a, b) => {
    const primary =
      key === "concept" ? collator.compare(a.concept, b.concept) : key === "type" ? byType(a, b) : key === "count" ? a.count - b.count : a.totalCents - b.totalCents;
    return dir * primary || byConcept(a, b);
  });
}

export function summarizeCoopcentral(movements: CoopcentralMovement[], groups: CoopcentralGroup[]): CoopcentralSummary {
  let totalCreditsCents = 0;
  let totalDebitsCents = 0;
  for (const m of movements) {
    totalCreditsCents += m.creditCents;
    totalDebitsCents += m.debitCents;
  }
  return {
    movementCount: movements.length,
    conceptCount: new Set(groups.map((g) => g.concept)).size,
    creditGroups: groups.filter((g) => g.transactionType === "credit").length,
    debitGroups: groups.filter((g) => g.transactionType === "debit").length,
    totalCreditsCents,
    totalDebitsCents,
    netCents: totalCreditsCents - totalDebitsCents,
  };
}
