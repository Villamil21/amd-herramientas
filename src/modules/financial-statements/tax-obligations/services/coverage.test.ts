import { describe, expect, it } from "vitest";
import type { TaxEmptyPeriod, TaxReturn } from "../types";
import { coverageYears, taxPeriodCoverage } from "./coverage";

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

describe("cobertura desde la constitución", () => {
  it("rango de años: de la constitución al año actual; sin fecha no se infiere", () => {
    expect(coverageYears("2022-05-10", 2026)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(coverageYears("2026-01-02", 2026)).toEqual([2026]);
    expect(coverageYears("", 2026)).toEqual([]);
    expect(coverageYears(null, 2026)).toEqual([]);
    expect(coverageYears("2030-01-01", 2026)).toEqual([]);
  });

  it("Renta: 2021 no aparece como falta para una empresa constituida en 2022", () => {
    const cells = taxPeriodCoverage("income", "annual", coverageYears("2022-05-10", 2026), [], [], { constitutionDate: "2022-05-10" });
    expect(cells.map((c) => c.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it("Retefuente: los meses anteriores a la constitución no son faltas", () => {
    const cells = taxPeriodCoverage("withholding", "monthly", [2022], [], [], { constitutionDate: "2022-05-10" });
    expect(cells.map((c) => c.period)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("IVA bimestral: el bimestre que contiene la constitución sí cuenta", () => {
    const cells = taxPeriodCoverage("vat", "bimonthly", [2022], [], [], { constitutionDate: "2022-05-10" });
    expect(cells.map((c) => c.period)).toEqual([3, 4, 5, 6]);
  });

  it("periodos que aún no terminan quedan «upcoming»; la corrección se agrupa bajo la vigente", () => {
    const old = ret(1, { id: 70, supersededBy: 71 });
    const cur = ret(1, { id: 71 });
    const cells = taxPeriodCoverage("withholding", "monthly", [2026], [old, cur], [], { today: "2026-02-15" });
    expect(cells[0].returns.map((r) => r.id)).toEqual([71]);
    expect(cells[0].history.map((r) => r.id)).toEqual([70]);
    expect(cells.map((c) => c.state)).toEqual(["declared", "upcoming", ...Array(10).fill("upcoming")]);
    expect(taxPeriodCoverage("withholding", "monthly", [2026], [], [], { today: "2026-02-15" })[0].state).toBe("missing");
  });
});
