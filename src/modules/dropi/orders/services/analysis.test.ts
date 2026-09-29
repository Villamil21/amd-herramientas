import { describe, expect, it } from "vitest";
import type { ConfigurableCategory, DropiOrderRow } from "../types";
import { analyzeOrders } from "./analysis";
import { statusKey } from "./statuses";

let nextRow = 2;
function row(id: string, status: string, purchase: number, extra: Partial<DropiOrderRow> = {}): DropiOrderRow {
  return {
    rowNumber: nextRow++,
    id,
    status,
    statusKey: statusKey(status),
    purchaseCents: purchase * 100,
    supplierCents: 0,
    freightCents: 0,
    returnFreightCents: 0,
    ...extra,
  };
}

const rules = (entries: [string, ConfigurableCategory][] = []) => new Map(entries);

describe("analyzeOrders", () => {
  const rows = [
    row("1", "ENTREGADO", 1000, { supplierCents: 40000, freightCents: 15000 }),
    row("2", "ENTREGADO", 2000, { supplierCents: 60000, freightCents: 14550 }),
    row("3", "CANCELADO", 300),
    row("4", "RECHAZADO", 400),
    row("5", "GUIA_ANULADA", 500),
    row("6", "Devolución", 600, { freightCents: 9000, returnFreightCents: 1894450 }),
    row("7", "EN PROCESO DE INDEMNIZACION", 700),
    row("8", "INDEMNIZADA", 800),
    row("9", "EN TERMINAL DESTINO", 900),
    row("10", "RECLAME EN OFICINA", 1100),
  ];

  it("suma Ventas Dropi con VALOR DE COMPRA EN PRODUCTOS por categoría", () => {
    const { summary } = analyzeOrders(
      rows,
      rules([
        ["EN TERMINAL DESTINO", "in_process"],
        ["RECLAME EN OFICINA", "claim"],
      ]),
    );
    expect(summary.billedCents).toBe(830000);
    expect(summary.cancelledRejectedVoidCents).toBe(120000);
    expect(summary.returnsCents).toBe(60000);
    expect(summary.indemnityCents).toBe(150000);
    expect(summary.inProcessCents).toBe(90000);
    expect(summary.claimCents).toBe(110000);
    expect(summary.deliveredCents).toBe(300000);
    expect(summary.unclassifiedCents).toBe(0);
  });

  it("calcula los costos solo con ENTREGADO y DEVOLUCION", () => {
    const { summary } = analyzeOrders(rows, rules());
    expect(summary.deliveredProductCostCents).toBe(100000);
    expect(summary.deliveredFreightCostCents).toBe(29550);
    expect(summary.returnFreightCostCents).toBe(1894450);
  });

  it("cuenta pedidos: despachados excluye solo Cancelado y Rechazado; Cancelados/Rechazados excluye Guía anulada", () => {
    const { summary } = analyzeOrders(rows, rules());
    expect(summary.dispatchedOrders).toBe(8); // incluye GUIA_ANULADA
    expect(summary.deliveredOrders).toBe(2);
    expect(summary.cancelledRejectedOrders).toBe(2);
    expect(summary.uniqueOrders).toBe(10);
  });

  it("cuenta IDs únicos (100, 100, 101 = 2 pedidos) sin deduplicar importes", () => {
    const a = analyzeOrders([row("100", "ENTREGADO", 10), row("100", "ENTREGADO", 10), row("101", "ENTREGADO", 10)], rules());
    expect(a.summary.uniqueOrders).toBe(2);
    expect(a.summary.deliveredOrders).toBe(2);
    expect(a.summary.totalRows).toBe(3);
    expect(a.summary.billedCents).toBe(3000);
    expect(a.repeatedIds).toEqual([{ id: "100", rows: 2 }]);
    expect(a.conflictingIds).toEqual([]);
  });

  it("advierte IDs con estados distintos sin contarlos dos veces en un indicador", () => {
    const a = analyzeOrders([row("123", "ENTREGADO", 10), row("123", "DEVOLUCION", 10), row("124", "ENTREGADO", 10), row("124", "ENTREGADO", 10)], rules());
    expect(a.conflictingIds).toEqual([{ id: "123", statuses: ["ENTREGADO", "DEVOLUCION"] }]);
    expect(a.summary.deliveredOrders).toBe(2);
    expect(a.summary.dispatchedOrders).toBe(2);
  });

  it("estado nuevo: se detecta, no se asigna solo y, al clasificarlo, se recalcula", () => {
    const data = [...rows, row("11", "ESTADO_NUEVO_DROPI", 1200)];
    const before = analyzeOrders(data, rules([["EN TERMINAL DESTINO", "in_process"]]));
    expect(before.complete).toBe(false);
    expect(before.pending.map((p) => p.display)).toEqual(["ESTADO_NUEVO_DROPI", "RECLAME EN OFICINA"]);
    expect(before.summary.unclassifiedCents).toBe(230000);
    expect(before.summary.inProcessCents).toBe(90000);

    const after = analyzeOrders(
      data,
      rules([
        ["EN TERMINAL DESTINO", "in_process"],
        ["RECLAME EN OFICINA", "claim"],
        ["ESTADO NUEVO DROPI", "in_process"],
      ]),
    );
    expect(after.complete).toBe(true);
    expect(after.pending).toEqual([]);
    expect(after.summary.inProcessCents).toBe(210000);
    expect(after.summary.claimCents).toBe(110000);
  });

  it("pregunta una sola vez por estado aunque aparezca en muchas filas", () => {
    const data = Array.from({ length: 500 }, (_, i) => row(String(i), i % 2 ? "GUIA_GENERADA" : "Guia generada", 1));
    const a = analyzeOrders(data, rules());
    expect(a.pending).toHaveLength(1);
    expect(a.pending[0]).toMatchObject({ rows: 500, uniqueOrders: 500, display: "Guia generada" });
  });

  it("las filas sin estatus dejan el cierre incompleto pero no se pueden clasificar", () => {
    const a = analyzeOrders([row("1", "", 10)], rules());
    expect(a.complete).toBe(false);
    expect(a.pending).toEqual([]);
    expect(a.statuses[0]).toMatchObject({ category: "unclassified", configurable: false });
  });
});
