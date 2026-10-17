import { describe, expect, it } from "vitest";
import type { BatchSummary } from "../../../types/fs";
import { decision, model, purchaseData, saleData, stored, upload } from "./domain/testkit";
import { buildEeffBatch, eeffSyncState, latestEeffBatch, staleCryptoYears } from "./eeffBatch";

const rows = () => [
  stored(1, "purchase", 2, purchaseData({ amount: 600_000_000, date: "2026-01-10", docType: "CC", doc: "1", firstName: "A", firstSurname: "B", city: "Cali" })),
  stored(1, "purchase", 3, purchaseData({ amount: 300_000_000, date: "2026-03-10", docType: "CC", doc: "2", firstName: "A", firstSurname: "C", city: "Cali" })),
  stored(1, "sale", 2, saleData({ amount: 2_000_000_000, docType: "NIT", doc: "800197268", business: "X" })),
];
const uploads = [upload(1, "a.xlsx")];
const batchOf = (input: ReturnType<typeof buildEeffBatch>, over: Partial<BatchSummary> = {}): BatchSummary => mk({ metadata: input?.metadata as Record<string, unknown>, ...over });

const mk = (over: Partial<BatchSummary>): BatchSummary => ({ id: 1, companyId: 1, source: "crypto_ops", fileName: "", periodLabel: "", periodStart: null, periodEnd: null, dedupeKey: "crypto:2026", recordCount: 1, totalCents: 1, status: "active", replacedBy: null, metadata: null, createdAt: "", ...over });

describe("efecto de Transacciones Cripto en Estados Financieros", () => {
  const base = buildEeffBatch(1, model({ uploads, rows: rows() }))!;

  it("arma un lote anual con llave por año y un movimiento por componente con valor", () => {
    expect(base.dedupeKey).toBe("crypto:2026");
    expect(base.source).toBe("crypto_ops");
    expect(base.periodEnd).toBe("2026-12-31");
    expect(base.movements.length).toBeGreaterThan(0);
  });

  it("antes del primer envío no actualiza solo; después queda al día si nada cambió", () => {
    expect(eeffSyncState(undefined, base)).toBe("none");
    expect(eeffSyncState(batchOf(base), base)).toBe("in_sync");
  });

  it("cambiar la fecha de corte pide actualizar el lote ya enviado", () => {
    const moved = buildEeffBatch(1, model({ uploads, rows: rows(), decisions: [decision("setting", "cutoff", "2026-06-30")] }))!;
    expect(moved.periodEnd).toBe("2026-06-30");
    expect(moved.movements.every((m) => m.accountingDate === "2026-06-30")).toBe(true);
    expect(eeffSyncState(batchOf(base), moved)).toBe("update");
  });

  it("cambiar la presentación, una carga o una decisión también actualiza", () => {
    const banks = buildEeffBatch(1, model({ uploads, rows: rows(), decisions: [decision("setting", "presentation", "banks")] }))!;
    expect(eeffSyncState(batchOf(base), banks)).toBe("update");
    const moreSales = buildEeffBatch(1, model({ uploads, rows: [...rows(), stored(1, "sale", 3, saleData({ amount: 500_000_000, docType: "NIT", doc: "900642307", business: "Y" }))] }))!;
    expect(eeffSyncState(batchOf(base), moreSales)).toBe("update");
  });

  it("si un pendiente impide calcular, el envío vigente se retira del cálculo y luego queda bloqueado", () => {
    const withBad = [...rows(), stored(1, "purchase", 9, purchaseData({ amount: 5, date: "2025-03-01", docType: "CC", doc: "9" }))];
    const blocked = buildEeffBatch(1, model({ uploads, rows: withBad }));
    expect(blocked).toBeNull();
    expect(eeffSyncState(batchOf(base), blocked)).toBe("retire");
    const retired = batchOf(base, { status: "voided", metadata: { ...(base.metadata as object), stale: 1, staleReason: "x" } });
    expect(eeffSyncState(retired, blocked)).toBe("stale");
  });

  it("al poder recalcular de nuevo, un envío retirado se vuelve a enviar sin intervención", () => {
    const retired = batchOf(base, { status: "voided", metadata: { stale: 1, staleReason: "x" } });
    expect(eeffSyncState(retired, base)).toBe("update");
  });

  it("el envío más reciente de un año es el vigente o el retirado por desactualizado", () => {
    const stale = mk({ id: 2, status: "voided", metadata: { stale: 1, staleReason: "hay duplicados" } });
    expect(latestEeffBatch([mk({ id: 1, status: "replaced" }), mk({ id: 3, dedupeKey: "crypto:2025" })], 2026)).toBeUndefined();
    expect(latestEeffBatch([mk({ id: 1, status: "replaced" }), stale], 2026)?.id).toBe(2);
    expect(latestEeffBatch([stale, mk({ id: 5 })], 2026)?.id).toBe(5);
  });

  it("solo bloquean los años cuyo último envío quedó retirado por desactualizado", () => {
    const stale = mk({ id: 2, status: "voided", metadata: { stale: 1, staleReason: "hay duplicados" } });
    expect(staleCryptoYears([stale])).toEqual([{ year: 2026, reason: "hay duplicados" }]);
    expect(staleCryptoYears([stale, mk({ id: 6 })])).toEqual([]);
    expect(staleCryptoYears([mk({ id: 7, status: "voided", metadata: null })])).toEqual([]);
  });
});
