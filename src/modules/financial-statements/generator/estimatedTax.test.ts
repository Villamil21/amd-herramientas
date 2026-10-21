import { describe, expect, it } from "vitest";
import type { TaxEmptyPeriod, TaxReturn } from "../tax-obligations/types";
import { periodRange } from "../tax-obligations/services/effects";
import { estimatedIncomeTaxNet, missingMonthsText } from "./estimatedTax";

let nextId = 1;
/** Formulario 350 mensual con autorretenciones (casilla 68), casilla 129 y distribución manual de la 129. */
function f350(year: number, month: number, o: { self?: number; c129?: number; adj?: { conceptKey: string; cents: number }[]; extra?: Partial<TaxReturn>; noDetail?: boolean } = {}): TaxReturn {
  const { start, end } = periodRange("monthly", year, month);
  const casillas: Record<string, number> = {};
  if (o.self !== undefined) casillas["68"] = o.self * 100;
  if (o.c129 !== undefined) casillas["129"] = o.c129 * 100;
  return {
    id: nextId++,
    companyId: 1,
    taxType: "withholding",
    year,
    period: month,
    periodicity: "monthly",
    periodStart: start,
    periodEnd: end,
    formNumber: `350-${nextId}`,
    previousFormNumber: "",
    isCorrection: false,
    supersededBy: null,
    payableCents: 0,
    favorCents: 0,
    payments: [],
    resolution: "",
    nit: "",
    companyName: "",
    fileName: "",
    incomeOrdinaryCents: null,
    incomeLossCents: null,
    advanceNextCents: null,
    advanceTargetYear: null,
    detail: o.noDetail ? {} : { presentedOn: `${end.slice(0, 7)}-15`, withholding: { casillas }, manual: { adjustments129: (o.adj ?? []).map((a, i) => ({ id: `a${i}`, conceptKey: a.conceptKey, cents: a.cents * 100, note: "" })) } },
    createdAt: "",
    updatedAt: "",
    events: [],
    ...o.extra,
  };
}

// Utilidad de $100.000.000 → estimado bruto $35.000.000.
const BASE = 100_000_000 * 100;
const calc = (returns: TaxReturn[], cut = "2026-03-31", extra: Partial<Parameters<typeof estimatedIncomeTaxNet>[0]> = {}) => estimatedIncomeTaxNet({ baseCents: BASE, returns, cut, ...extra });

describe("Impuesto de renta estimado neto", () => {
  it("1. utilidad positiva sin 350: neto = bruto y avisa los meses faltantes", () => {
    const r = calc([]);
    expect(r.grossCents).toBe(35_000_000 * 100);
    expect(r.selfWithholdingCents).toBe(0);
    expect(r.resultCents).toBe(r.grossCents);
    expect(r.kind).toBe("tax");
    expect(r.missingMonths).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(r.partial).toBe(true);
    expect(missingMonthsText(r.missingMonths)).toBe("enero 2026, febrero 2026, marzo 2026");
  });

  it("sin utilidad positiva el bruto es 0", () => {
    expect(estimatedIncomeTaxNet({ baseCents: -5_000_000_00, returns: [], cut: "2026-03-31" }).grossCents).toBe(0);
  });

  it("2. uno y varios 350: resta las autorretenciones netas", () => {
    const one = calc([f350(2026, 1, { self: 1_000_000 }), f350(2026, 2, { self: 0, c129: 0 }), f350(2026, 3, { self: 0 })].slice(0, 1));
    expect(one.selfWithholdingCents).toBe(1_000_000 * 100);
    expect(one.resultCents).toBe((35_000_000 - 1_000_000) * 100);
    const many = calc([f350(2026, 1, { self: 1_000_000 }), f350(2026, 2, { self: 2_500_000 }), f350(2026, 3, { self: 500_000 })]);
    expect(many.included).toHaveLength(3);
    expect(many.selfWithholdingCents).toBe(4_000_000 * 100);
    expect(many.resultCents).toBe(31_000_000 * 100);
    expect(many.missingMonths).toEqual([]);
    expect(many.partial).toBe(false);
  });

  it("3. ejemplo obligatorio: 120.000 − 5.000 clasificados = 115.000 (de 30.000 de excesos totales)", () => {
    const r = calc([f350(2026, 1, { self: 120_000, c129: 30_000, adj: [{ conceptKey: "self", cents: 5_000 }, { conceptKey: "services", cents: 25_000 }] })]);
    const [form] = r.included;
    expect(form.grossCents).toBe(120_000 * 100);
    expect(form.classifiedReturnsCents).toBe(5_000 * 100);
    expect(form.netCents).toBe(115_000 * 100);
    expect(form.otherConceptsCents).toBe(25_000 * 100);
    expect(form.undistributedCents).toBe(0);
    expect(r.selfWithholdingCents).toBe(115_000 * 100);
  });

  it("4. devoluciones de otros conceptos no reducen las autorretenciones", () => {
    const r = calc([f350(2026, 1, { self: 120_000, c129: 30_000, adj: [{ conceptKey: "purchases", cents: 30_000 }] })]);
    expect(r.included[0].netCents).toBe(120_000 * 100);
    expect(r.included[0].otherConceptsCents).toBe(30_000 * 100);
  });

  it("5. casilla 129 sin distribuir queda pendiente, no se asigna y marca el estimado como parcial", () => {
    const r = calc([f350(2026, 1, { self: 120_000, c129: 30_000, adj: [{ conceptKey: "self", cents: 5_000 }] }), f350(2026, 2, { self: 0 }), f350(2026, 3, { self: 0 })]);
    const form = r.included[0];
    expect(form.netCents).toBe(115_000 * 100);
    expect(form.undistributedCents).toBe(25_000 * 100);
    expect(r.undistributedCents).toBe(25_000 * 100);
    expect(r.selfWithholdingCents).toBe(115_000 * 100);
    expect(r.partial).toBe(true);
  });

  it("6. otro año, posterior al corte, o con periodo sin terminar: no se incluyen", () => {
    const r = calc([f350(2025, 12, { self: 9_000_000 }), f350(2026, 1, { self: 1_000_000 }), f350(2026, 4, { self: 7_000_000 })], "2026-03-31");
    expect(r.included.map((x) => x.period)).toHaveLength(1);
    expect(r.selfWithholdingCents).toBe(1_000_000 * 100);
    // El corte a mitad de mes deja fuera el mes en curso.
    const mid = calc([f350(2026, 1, { self: 1_000_000 }), f350(2026, 2, { self: 2_000_000 })], "2026-02-15");
    expect(mid.selfWithholdingCents).toBe(1_000_000 * 100);
    expect(mid.missingMonths).toEqual([]);
  });

  it("7. declaración corregida: solo cuenta la versión vigente", () => {
    const old = f350(2026, 1, { self: 1_000_000 });
    const fixed = f350(2026, 1, { self: 1_200_000, extra: { isCorrection: true } });
    old.supersededBy = fixed.id;
    const r = calc([old, fixed, f350(2026, 2, { self: 0 }), f350(2026, 3, { self: 0 })]);
    expect(r.included.filter((x) => x.returnId === old.id)).toHaveLength(0);
    expect(r.selfWithholdingCents).toBe(1_200_000 * 100);
  });

  it("8. autorretenciones mayores al estimado: saldo a favor visible, no cero", () => {
    const r = calc([f350(2026, 1, { self: 40_000_000 })], "2026-01-31");
    expect(r.resultCents).toBe(-5_000_000 * 100);
    expect(r.kind).toBe("favor");
    expect(r.displayCents).toBe(5_000_000 * 100);
    // Sin utilidad: todo lo autorretenido es saldo a favor.
    const loss = estimatedIncomeTaxNet({ baseCents: -1, returns: [f350(2026, 1, { self: 100_000 })], cut: "2026-01-31" });
    expect(loss.kind).toBe("favor");
    expect(loss.displayCents).toBe(100_000 * 100);
  });

  it("9. meses sin 350: advertencia parcial; «sin obligación» y anteriores a la constitución no cuentan", () => {
    const empties = [{ id: 1, companyId: 1, taxType: "withholding", year: 2026, period: 2, periodicity: "monthly", confirmation: "", status: "active", createdAt: "", voidedAt: null }] as TaxEmptyPeriod[];
    const r = calc([f350(2026, 1, { self: 100 })], "2026-04-30", { empties, constitutionDate: "2026-01-10" });
    expect(r.missingMonths).toEqual(["2026-03", "2026-04"]);
    expect(r.partial).toBe(true);
    const late = calc([], "2026-04-30", { constitutionDate: "2026-03-05" });
    expect(late.missingMonths).toEqual(["2026-03", "2026-04"]);
    // Una anulación del «sin obligación» vuelve el mes a faltante.
    const voided = calc([], "2026-02-28", { empties: [{ ...empties[0], status: "voided" }] });
    expect(voided.missingMonths).toEqual(["2026-01", "2026-02"]);
  });

  it("un 350 sin casillas leídas marca parcial: no se inventa su autorretención", () => {
    const r = calc([f350(2026, 1, { noDetail: true })], "2026-01-31");
    expect(r.included[0].noDetail).toBe(true);
    expect(r.partial).toBe(true);
    expect(r.resultCents).toBe(r.grossCents);
  });

  it("usa el estimado bruto indicado (EEFF cerrado) en vez de recalcularlo", () => {
    const r = estimatedIncomeTaxNet({ baseCents: BASE, grossPesos: 12_345_000, returns: [f350(2026, 1, { self: 345_000 })], cut: "2026-01-31" });
    expect(r.grossCents).toBe(12_345_000 * 100);
    expect(r.resultCents).toBe(12_000_000 * 100);
  });

  it("no modifica sus entradas", () => {
    const returns = [f350(2026, 1, { self: 120_000, c129: 30_000, adj: [{ conceptKey: "self", cents: 5_000 }] })];
    const before = JSON.stringify(returns);
    calc(returns);
    expect(JSON.stringify(returns)).toBe(before);
  });
});
