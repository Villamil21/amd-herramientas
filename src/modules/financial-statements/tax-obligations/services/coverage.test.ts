import { describe, expect, it } from "vitest";
import type { TaxEmptyPeriod, TaxReturn } from "../types";
import { taxPeriodCoverage } from "./coverage";

const ret = (period: number | null, extra: Partial<TaxReturn> = {}) => ({ id: period ?? 0, taxType: "withholding", year: 2026, period, periodicity: "monthly", supersededBy: null, ...extra }) as TaxReturn;
const empty = (period: number | null, extra: Partial<TaxEmptyPeriod> = {}): TaxEmptyPeriod => ({ id: 1, companyId: 1, taxType: "withholding", year: 2026, period, periodicity: "monthly", confirmation: "x", status: "active", createdAt: "", voidedAt: null, ...extra });

describe("cobertura de obligaciones tributarias", () => {
  it("Retefuente: 12 meses declarados, sin obligación o faltantes; reemplazadas y anuladas no cuentan", () => {
    const cells = taxPeriodCoverage("withholding", "monthly", [2026], [ret(1), ret(2, { supersededBy: 9 })], [empty(3), empty(4, { status: "voided" })]);
    expect(cells).toHaveLength(12);
    expect(cells.slice(0, 5).map((c) => c.state)).toEqual(["declared", "missing", "empty", "missing", "missing"]);
  });

  it("IVA según la periodicidad de la empresa; Renta por año; sin periodicidad no se adivina", () => {
    expect(taxPeriodCoverage("vat", "four_monthly", [2026], [ret(2, { taxType: "vat", periodicity: "four_monthly" })], []).map((c) => c.state)).toEqual(["missing", "declared", "missing"]);
    expect(taxPeriodCoverage("vat", null, [2026], [], [])).toEqual([]);
    const income = taxPeriodCoverage("income", "annual", [2024, 2025], [ret(null, { taxType: "income", periodicity: "annual", year: 2024 })], [empty(null, { taxType: "income", periodicity: "annual", year: 2025 })]);
    expect(income.map((c) => [c.label, c.state])).toEqual([
      ["Año gravable 2024", "declared"],
      ["Año gravable 2025", "empty"],
    ]);
  });
});
