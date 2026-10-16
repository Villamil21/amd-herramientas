import { describe, expect, it } from "vitest";
import type { Company } from "../../../../types/models";
import type { ParsedTaxReturn } from "../parser/taxReturnParser";
import type { TaxReturn } from "../types";
import { buildDraft, draftBlockers, draftInput, withExisting } from "./importDraft";

const company = { id: 7, razonSocial: "KAES SAS", nit: "901748281-2" } as Company;
const value = (cents: number) => ({ label: "", cents, casilla: null, expectedCasilla: null, foundBy: "label" as const });
const parsed = (extra: Partial<ParsedTaxReturn> = {}): ParsedTaxReturn => ({
  taxType: "vat",
  formCode: "300",
  year: 2026,
  yearSource: "form",
  presentedOn: "2026-10-05",
  period: 2,
  periodicity: "four_monthly",
  nit: "901748281",
  dv: "2",
  companyName: "KAES S.A.S",
  formNumber: "3004737625041",
  previousFormNumber: "",
  values: { vatPayable: value(0), vatFavor: value(9_313_400_000) },
  equity: [],
  warnings: [],
  ...extra,
});

describe("borrador de importación", () => {
  it("relaciona la empresa por NIT y arma el periodo cuatrimestral del formulario", () => {
    const d = buildDraft(parsed(), "IVA.pdf", [company], [], null);
    expect([d.company?.id, d.nameMismatch, d.periodicity]).toEqual([7, false, "four_monthly"]);
    expect(draftBlockers(d, false, false)).toEqual([]);
    const input = draftInput(d, "form");
    expect([input.periodStart, input.periodEnd, input.favorCents, input.payableCents, input.replacesId]).toEqual(["2026-05-01", "2026-08-31", 9_313_400_000, 0, null]);
  });

  it("sin empresa con ese NIT, con nombre muy distinto o con el formulario repetido no se guarda", () => {
    expect(draftBlockers(buildDraft(parsed({ nit: "800000000" }), "x.pdf", [company], [], null), true, true)[0]).toContain("No hay una empresa con NIT 800000000");
    const other = buildDraft(parsed({ companyName: "OTRA COMPAÑÍA DISTINTA" }), "x.pdf", [company], [], null);
    expect([other.nameMismatch, draftBlockers(other, false, false).length, draftBlockers(other, true, false).length]).toEqual([true, 1, 0]);
    const dup = buildDraft(parsed(), "x.pdf", [company], [{ formNumber: "3004737625041" } as TaxReturn], null);
    expect(draftBlockers(dup, true, true)[0]).toContain("ya fue importado");
  });

  it("IVA con casillas 88 y 89 ambas mayores que cero: bloquea y pide revisión", () => {
    const both = buildDraft(parsed({ values: { vatPayable: value(100_000), vatFavor: value(200_000) } }), "x.pdf", [company], [], null);
    expect(draftBlockers(both, true, true)).toEqual(["Las casillas 88 (Total saldo a pagar) y 89 (Total saldo a favor) son ambas mayores que cero: revisa la declaración antes de importarla."]);
  });

  it("otro formulario del mismo periodo solo entra como corrección confirmada", () => {
    const existing = { id: 3, taxType: "vat", year: 2026, period: 2, supersededBy: null, formNumber: "1" } as TaxReturn;
    const d = buildDraft(parsed(), "x.pdf", [company], [existing], "four_monthly");
    expect(draftBlockers(d, false, false)).toEqual(["Ya existe una declaración de este periodo: confirma que la nueva es una corrección."]);
    expect(draftInput(d, "form")).toMatchObject({ replacesId: 3, isCorrection: true });
    expect(buildDraft(parsed({ previousFormNumber: "1" }), "x.pdf", [company], [existing], "four_monthly").correctsExisting).toBe(true);
  });

  it("renta sin año en el texto: se puede corregir el año propuesto y el anticipo va al año siguiente", () => {
    const renta = parsed({ taxType: "income", formCode: "110", year: 2018, yearSource: "presentation", period: null, periodicity: null, values: { incomeOrdinary: value(0), incomeLoss: value(853_500_000), incomeAdvanceNext: value(0), incomePayable: value(61_500_000), incomeFavor: value(0) } });
    const d = withExisting({ ...buildDraft(renta, "DR.pdf", [company], [], null), year: 2017 }, []);
    expect(draftInput(d, "manual")).toMatchObject({ year: 2017, periodicity: "annual", periodEnd: "2017-12-31", advanceTargetYear: 2018, incomeLossCents: 853_500_000, payableCents: 61_500_000 });
  });
});
