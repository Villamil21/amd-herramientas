import { normalizeDescription } from "../../shared/groupingService";
import type { SortDirection } from "../../shared/components/tableControls";
import { TYPE_ORDER } from "../../shared/types";
import type { BancoomevaGroup, BancoomevaMovement, BancoomevaSummary } from "../types";

/**
 * Agrupación ESTRICTA por DESCRIPCION exacta + tipo (crédito o débito). Una
 * misma descripción con créditos y débitos produce dos grupos: nunca se
 * netean. Sin coincidencias aproximadas; solo se normalizan espacios. La
 * Oficina no interviene.
 */
export function groupBancoomevaMovements(movements: BancoomevaMovement[]): BancoomevaGroup[] {
  const groups = new Map<string, BancoomevaGroup>();
  for (const m of movements) {
    const description = normalizeDescription(m.description);
    const key = `${description}|${m.transactionType}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, description, transactionType: m.transactionType, count: 0, totalCents: 0, movements: [] };
      groups.set(key, group);
    }
    group.movements.push(m);
    group.count += 1;
    group.totalCents += m.amountCents;
  }
  return sortBancoomevaGroups([...groups.values()], "description", "asc");
}

export type BancoomevaSortKey = "description" | "type" | "count" | "total";

const collator = new Intl.Collator("es", { sensitivity: "variant", numeric: true });

/** Orden por el criterio elegido y, en empate, descripción y luego tipo (crédito antes que débito). */
export function sortBancoomevaGroups(groups: BancoomevaGroup[], key: BancoomevaSortKey, direction: SortDirection): BancoomevaGroup[] {
  const dir = direction === "asc" ? 1 : -1;
  const byType = (a: BancoomevaGroup, b: BancoomevaGroup) => TYPE_ORDER[a.transactionType] - TYPE_ORDER[b.transactionType];
  const byDescription = (a: BancoomevaGroup, b: BancoomevaGroup) => collator.compare(a.description, b.description) || byType(a, b);
  return [...groups].sort((a, b) => {
    const primary =
      key === "description" ? collator.compare(a.description, b.description) : key === "type" ? byType(a, b) : key === "count" ? a.count - b.count : a.totalCents - b.totalCents;
    return dir * primary || byDescription(a, b);
  });
}

export function summarizeBancoomeva(movements: BancoomevaMovement[], groups: BancoomevaGroup[]): BancoomevaSummary {
  let totalCreditsCents = 0;
  let totalDebitsCents = 0;
  for (const m of movements) {
    totalCreditsCents += m.creditCents;
    totalDebitsCents += m.debitCents;
  }
  return {
    movementCount: movements.length,
    conceptCount: new Set(groups.map((g) => g.description)).size,
    creditGroups: groups.filter((g) => g.transactionType === "credit").length,
    debitGroups: groups.filter((g) => g.transactionType === "debit").length,
    totalCreditsCents,
    totalDebitsCents,
    netCents: totalCreditsCents - totalDebitsCents,
  };
}
