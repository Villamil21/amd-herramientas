import { describe, expect, it } from "vitest";
import type { BatchSummary } from "../../../types/fs";
import { liveMovements } from "../crypto/eeffBatch";
import { isLegacyPurchasesBatch } from "./eeff";

const batch = (id: number, over: Partial<BatchSummary>): BatchSummary => ({ id, companyId: 1, source: "purchases", fileName: "", periodLabel: "", periodStart: null, periodEnd: null, dedupeKey: "", recordCount: 1, totalCents: 0, status: "active", replacedBy: null, metadata: null, createdAt: "", ...over });

describe("lotes antiguos de Clasificación contable de compras", () => {
  const batches = [batch(1, { dedupeKey: "" }), batch(2, { dedupeKey: "cufe-viejo" }), batch(3, { dedupeKey: "purchases:2026" }), batch(4, { dedupeKey: "empty:2026-05", metadata: { emptyPeriod: true } }), batch(5, { source: "bank", dedupeKey: "" })];
  const movements = batches.map((b) => ({ batchId: b.id, amountCents: 100 }));

  it("se reconocen como antiguos solo los de compras que no son del módulo nuevo ni «Sin compras»", () => {
    expect(batches.filter(isLegacyPurchasesBatch).map((b) => b.id)).toEqual([1, 2]);
  });

  it("no alimentan el cálculo vigente aunque sigan activos: sin doble conteo con el lote anual nuevo", () => {
    const live = liveMovements(movements, batches);
    expect(live.map((m) => m.batchId)).toEqual([3, 4, 5]);
    expect(live.filter((m) => m.batchId === 3)).toHaveLength(1);
  });
});
