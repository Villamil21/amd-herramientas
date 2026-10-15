import { describe, expect, it } from "vitest";
import type { BatchSummary, Movement } from "../../../types/fs";
import { activeDuplicates, coverage } from "./checks";

const mv = (id: number, date: string, batchId: number, extra: Partial<Movement> = {}) =>
  ({ id, companyId: 1, batchId, accountingDate: date, source: "purchases", documentId: `d${id}`, status: "active", amountCents: 1, pucCode: "513595" }) as Movement & typeof extra;

const batch = (id: number): BatchSummary => ({ id, companyId: 1, source: "purchases", fileName: `lote${id}`, periodLabel: "", periodStart: null, periodEnd: null, dedupeKey: "", recordCount: 1, totalCents: 1, status: "active", replacedBy: null, metadata: null, createdAt: "2026-10-14" });

describe("cobertura mensual", () => {
  it("no supone importación secuencial: muestra exactamente los meses que faltan", () => {
    const movements = [mv(1, "2026-01-15", 1), mv(2, "2026-02-03", 2), mv(3, "2026-04-20", 3), mv(4, "2026-06-30", 4), mv(5, "2026-09-01", 5)];
    const c = coverage("2026-01-01", "2026-08-31", movements, [], [1, 2, 3, 4, 5].map(batch));
    const purchases = c.rows.find((r) => r.source === "purchases")!;
    expect(c.months).toHaveLength(8);
    expect(c.months.filter((m) => purchases.cells[m].loaded)).toEqual(["2026-01", "2026-02", "2026-04", "2026-06"]);
    expect(purchases.missing).toEqual(["2026-03", "2026-05", "2026-07", "2026-08"]);
    expect(purchases.cells["2026-04"].batches.map((b) => b.fileName)).toEqual(["lote3"]);
    expect(c.rows.find((r) => r.source === "payroll")!.empty).toBe(true);
  });

  it("un mes con solo información reemplazada no cuenta como cargado, pero muestra el lote", () => {
    const c = coverage("2026-01-01", "2026-01-31", [{ ...mv(1, "2026-01-15", 1), status: "replaced" }], [], [batch(1)]);
    const cell = c.rows[0].cells["2026-01"];
    expect([cell.loaded, cell.batches.length]).toEqual([false, 1]);
  });
});

describe("duplicados activos", () => {
  it("detecta un documento activo en dos importaciones", () => {
    expect(activeDuplicates([mv(1, "2026-01-01", 1), { ...mv(2, "2026-01-01", 2), documentId: "d1" }, { ...mv(3, "2026-01-01", 3), documentId: "d1", status: "replaced" }])).toEqual([{ source: "purchases", documentId: "d1", batchIds: [1, 2] }]);
  });
});
