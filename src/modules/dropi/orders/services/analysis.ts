import type { DropiOrderRow, DropiOrdersAnalysis, DropiOrdersSummary, StatusCategory, StatusDetail, StatusRules } from "../types";
import { classifyStatus, fixedStatus } from "./statuses";

/**
 * Cierre de órdenes a partir de las filas ya leídas y de las reglas guardadas.
 * Es una función pura: al clasificar un estado basta con volver a llamarla.
 *
 * - Importes: se suman por FILA (no se deduplican por ID sin evidencia).
 * - Pedidos: siempre COUNT(DISTINCT ID); un ID cuenta en un indicador si
 *   alguna de sus filas pertenece al grupo.
 */
export function analyzeOrders(rows: DropiOrderRow[], rules: StatusRules): DropiOrdersAnalysis {
  const byStatus = new Map<string, StatusDetail & { ids: Set<string> }>();
  const allIds = new Set<string>();
  const dispatched = new Set<string>();
  const delivered = new Set<string>();
  const cancelledRejected = new Set<string>();
  const rowsById = new Map<string, number>();
  const statusesById = new Map<string, Map<string, string>>();

  const summary: DropiOrdersSummary = {
    billedCents: 0,
    cancelledRejectedVoidCents: 0,
    returnsCents: 0,
    inProcessCents: 0,
    claimCents: 0,
    indemnityCents: 0,
    deliveredCents: 0,
    unclassifiedCents: 0,
    deliveredProductCostCents: 0,
    deliveredFreightCostCents: 0,
    returnFreightCostCents: 0,
    dispatchedOrders: 0,
    deliveredOrders: 0,
    cancelledRejectedOrders: 0,
    totalRows: rows.length,
    uniqueOrders: 0,
  };

  const valueKey: Record<StatusCategory, keyof DropiOrdersSummary> = {
    delivered: "deliveredCents",
    cancelled_group: "cancelledRejectedVoidCents",
    returned: "returnsCents",
    in_process: "inProcessCents",
    claim: "claimCents",
    indemnity: "indemnityCents",
    unclassified: "unclassifiedCents",
  };

  for (const row of rows) {
    const fixed = fixedStatus(row.statusKey);
    const category = classifyStatus(row.statusKey, rules);

    let detail = byStatus.get(row.statusKey);
    if (!detail) {
      detail = {
        key: row.statusKey,
        display: row.status,
        category,
        fixed,
        configurable: !fixed && row.statusKey !== "",
        rows: 0,
        uniqueOrders: 0,
        purchaseCents: 0,
        supplierCents: 0,
        freightCents: 0,
        returnFreightCents: 0,
        ids: new Set(),
      };
      byStatus.set(row.statusKey, detail);
    }
    detail.rows++;
    detail.purchaseCents += row.purchaseCents;
    detail.supplierCents += row.supplierCents;
    detail.freightCents += row.freightCents;
    detail.returnFreightCents += row.returnFreightCents;

    summary.billedCents += row.purchaseCents;
    summary[valueKey[category]] += row.purchaseCents;
    if (fixed === "delivered") {
      summary.deliveredProductCostCents += row.supplierCents;
      summary.deliveredFreightCostCents += row.freightCents;
    }
    if (fixed === "returned") summary.returnFreightCostCents += row.returnFreightCents;

    // Filas sin ID: sus importes cuentan, pero no son un pedido identificable.
    if (!row.id) continue;
    detail.ids.add(row.id);
    allIds.add(row.id);
    rowsById.set(row.id, (rowsById.get(row.id) ?? 0) + 1);
    let statuses = statusesById.get(row.id);
    if (!statuses) statusesById.set(row.id, (statuses = new Map()));
    if (!statuses.has(row.statusKey)) statuses.set(row.statusKey, row.status);

    // Despachados: todos menos Cancelado y Rechazado (GUIA_ANULADA sí cuenta).
    if (fixed !== "cancelled" && fixed !== "rejected") dispatched.add(row.id);
    if (fixed === "delivered") delivered.add(row.id);
    // Cancelados / Rechazados: sin GUIA_ANULADA (distinto del bloque monetario).
    if (fixed === "cancelled" || fixed === "rejected") cancelledRejected.add(row.id);
  }

  summary.uniqueOrders = allIds.size;
  summary.dispatchedOrders = dispatched.size;
  summary.deliveredOrders = delivered.size;
  summary.cancelledRejectedOrders = cancelledRejected.size;

  const statuses: StatusDetail[] = [...byStatus.values()]
    .map(({ ids, ...d }) => ({ ...d, uniqueOrders: ids.size }))
    .sort((a, b) => b.rows - a.rows || a.display.localeCompare(b.display, "es"));
  const pending = statuses.filter((s) => s.category === "unclassified" && s.configurable);

  return {
    summary,
    statuses,
    pending,
    complete: statuses.every((s) => s.category !== "unclassified"),
    repeatedIds: [...rowsById].filter(([, n]) => n > 1).map(([id, n]) => ({ id, rows: n })),
    conflictingIds: [...statusesById].filter(([, s]) => s.size > 1).map(([id, s]) => ({ id, statuses: [...s.values()] })),
  };
}
