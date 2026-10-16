import { describe, expect, it } from "vitest";
import { TAX_PUC, type TaxReturn } from "../types";
import { periodRange } from "./effects";
import { incomeComposition } from "./incomeComposition";

let id = 1;
const base = (over: Partial<TaxReturn>): TaxReturn => {
  const taxType = over.taxType ?? "withholding";
  const range = periodRange(over.periodicity ?? "monthly", over.year ?? 2026, over.period ?? null);
  return {
    id: id++, companyId: 1, taxType, year: 2026, period: 1, periodicity: "monthly", periodStart: range.start, periodEnd: range.end, formNumber: "1", previousFormNumber: "", isCorrection: false, supersededBy: null,
    payableCents: 0, favorCents: 0, payments: [], resolution: "", nit: "", companyName: "", fileName: "", incomeOrdinaryCents: null, incomeLossCents: null, advanceNextCents: null, advanceTargetYear: null,
    detail: {}, createdAt: "", updatedAt: "", events: [], ...over,
  };
};
const value = (cents: number) => ({ label: "x", cents, casilla: null, expectedCasilla: null, foundBy: "label" as const });
const selfRet = (period: number, pesos: number) => base({ taxType: "withholding", year: 2026, period, detail: { withholding: { casillas: { "68": pesos * 100, "138": pesos * 100 } } }, payableCents: pesos * 100 });

describe("composición de la renta por pagar", () => {
  const dr2025 = base({ taxType: "income", year: 2025, period: null, periodicity: "annual", payableCents: 8_000_000_00, advanceNextCents: 12_000_000_00, advanceTargetYear: 2026, detail: { presentedOn: "2026-04-10", values: { incomeTaxDue: value(10_000_000_00), incomeAdvancePrior: value(1_500_000_00), incomeSelfWithholding: value(500_000_00) } } });
  const dr2024 = base({ taxType: "income", year: 2024, period: null, periodicity: "annual", payableCents: 0, advanceNextCents: 7_000_000_00, advanceTargetYear: 2025 });
  const puc = new Map([[TAX_PUC.incomePayable, "240405"], [TAX_PUC.incomeAdvance, "135595"], ["tax.wh.self", "236570"]]);

  it("liquidación declarada: impuesto − anticipo − autorretenciones con sus fuentes y PUC", () => {
    const c = incomeComposition([dr2025, dr2024], "2026-08-31", puc);
    expect(c.declarations).toHaveLength(1);
    expect(c.declarations[0].lines.map((l) => [l.key, l.cents])).toEqual([["tax", 10_000_000_00], ["advance", -1_500_000_00], ["self", -500_000_00]]);
    expect(c.declarations[0].lines[0]).toMatchObject({ pucCode: "240405" });
    expect(c.declarations[0]).toMatchObject({ payableCents: 8_000_000_00, pendingCents: 8_000_000_00, noncurrent: false });
  });

  it("para EEFF 2026 el anticipo es solo el de la renta 2025 (no el de 2024) y las autorretenciones son las practicadas en 2026", () => {
    const c = incomeComposition([dr2025, dr2024, selfRet(1, 30_000), selfRet(2, 20_000), { ...selfRet(9, 99_000), year: 2025, periodStart: "2025-09-01", periodEnd: "2025-09-30" }], "2026-08-31", puc);
    expect(c.advance).toMatchObject({ cents: 12_000_000_00, source: "Declaración de renta 2025", pucCode: "135595" });
    expect(c.selfWithholding.total.cents).toBe(50_000_00);
    expect(c.selfWithholding.periods).toHaveLength(2);
    expect(c.discountsCents).toBe(12_000_000_00 + 50_000_00);
    // El 31/12 el anticipo se consume en la liquidación del año.
    expect(incomeComposition([dr2025], "2026-12-31", puc).advance).toBeNull();
  });
});
