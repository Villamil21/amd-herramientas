import { describe, expect, it } from "vitest";
import { TAX_PUC, type TaxPeriodicity, type TaxReturn, type TaxType } from "../types";
import { anomalies, lastEndedPeriod, periodName, periodRange, taxEffects, taxStatus, type TaxInput } from "./effects";

let nextId = 1;
function ret(taxType: TaxType, year: number, period: number | null, periodicity: TaxPeriodicity, extra: Partial<TaxReturn> = {}): TaxReturn {
  const { start, end } = periodRange(periodicity, year, period);
  return {
    id: nextId++,
    companyId: 1,
    taxType,
    year,
    period,
    periodicity,
    periodStart: start,
    periodEnd: end,
    formNumber: String(nextId),
    previousFormNumber: "",
    isCorrection: false,
    supersededBy: null,
    payableCents: 0,
    favorCents: 0,
    paymentDate: null,
    resolution: "",
    nit: "",
    companyName: "",
    fileName: "",
    incomeOrdinaryCents: null,
    incomeLossCents: null,
    advanceNextCents: null,
    advanceTargetYear: taxType === "income" ? year + 1 : null,
    detail: {},
    createdAt: "",
    updatedAt: "",
    events: [],
    ...extra,
  };
}

const PUC = new Map<string, string>(Object.values(TAX_PUC).map((k, i) => [k, String(240000 + i)]));
const run = (returns: TaxReturn[], cut: string, extra: Partial<TaxInput> = {}) => taxEffects({ returns, puc: PUC, vatPeriodicity: "bimonthly", ...extra }, cut);
const total = (r: ReturnType<typeof run>, kind: string) => r.effects.filter((e) => e.kind === kind).reduce((s, e) => s + e.cents, 0);
const pesos = (n: number) => n * 100;

describe("periodos", () => {
  it("bimestral y cuatrimestral según la periodicidad, no solo por el número", () => {
    expect(periodRange("bimonthly", 2026, 4)).toEqual({ start: "2026-07-01", end: "2026-08-31" });
    expect(periodRange("four_monthly", 2026, 2)).toEqual({ start: "2026-05-01", end: "2026-08-31" });
    expect(periodRange("monthly", 2026, 9)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(periodName(ret("vat", 2026, 4, "bimonthly"))).toBe("P4 Jul–Ago 2026");
    expect(periodName(ret("vat", 2026, 3, "four_monthly"))).toBe("P3 Sep–Dic 2026");
  });

  it("último periodo terminado al corte", () => {
    expect(lastEndedPeriod("bimonthly", "2026-06-30")).toMatchObject({ year: 2026, period: 3 });
    expect(lastEndedPeriod("bimonthly", "2026-08-31")).toMatchObject({ year: 2026, period: 4 });
    expect(lastEndedPeriod("bimonthly", "2026-08-30")).toMatchObject({ year: 2026, period: 3 });
    expect(lastEndedPeriod("four_monthly", "2026-03-31")).toMatchObject({ year: 2025, period: 3 });
  });
});

describe("prueba obligatoria — Retefuente", () => {
  const r = ret("withholding", 2026, 9, "monthly", { payableCents: pesos(624_000), paymentDate: "2026-10-15" });
  it("agosto: no aparece · septiembre: CxP $624.000 · octubre: $0", () => {
    expect(total(run([r], "2026-08-31"), "withholding_payable")).toBe(0);
    expect(total(run([r], "2026-09-30"), "withholding_payable")).toBe(pesos(624_000));
    expect(total(run([r], "2026-10-31"), "withholding_payable")).toBe(0);
  });
  it("sin fecha de pago sigue como cuenta por pagar; la presentación no es pago", () => {
    expect(total(run([{ ...r, paymentDate: null, detail: { presentedOn: "2026-10-05" } }], "2026-12-31"), "withholding_payable")).toBe(pesos(624_000));
    expect(taxStatus({ ...r, paymentDate: null }, null)).toBe("pending");
    expect(taxStatus(r, null)).toBe("paid");
  });
});

describe("prueba obligatoria — IVA saldo a favor (foto, nunca suma)", () => {
  const p3 = ret("vat", 2026, 3, "bimonthly", { favorCents: pesos(29_966_000) });
  const p4 = ret("vat", 2026, 4, "bimonthly", { favorCents: pesos(37_878_000) });
  it("junio: $29.966.000 · agosto: $37.878.000 · nunca $67.844.000", () => {
    expect(total(run([p3, p4], "2026-06-30"), "vat_favor")).toBe(pesos(29_966_000));
    expect(total(run([p3, p4], "2026-08-31"), "vat_favor")).toBe(pesos(37_878_000));
  });
  it("no usa una declaración posterior al corte ni, si falta el último periodo, una anterior", () => {
    expect(total(run([p4], "2026-07-31"), "vat_favor")).toBe(0);
    const missing = run([p3], "2026-08-31");
    expect(total(missing, "vat_favor")).toBe(0);
    expect(missing.issues).toEqual([expect.objectContaining({ level: "warning", message: expect.stringContaining("P4 Jul–Ago 2026") })]);
  });
});

describe("prueba obligatoria — IVA saldo a pagar", () => {
  const p4 = ret("vat", 2026, 4, "bimonthly", { payableCents: pesos(5_000_000), paymentDate: "2026-09-15" });
  it("agosto: CxP $5.000.000 · septiembre: $0", () => {
    expect(total(run([p4], "2026-08-31"), "vat_payable")).toBe(pesos(5_000_000));
    expect(total(run([p4], "2026-09-30"), "vat_payable")).toBe(0);
  });
  it("con saldo a pagar y a favor a la vez requiere revisión y no se envía hasta resolverla", () => {
    const both = { ...p4, paymentDate: null, favorCents: pesos(1_000) };
    const s = run([both], "2026-08-31");
    expect(s.effects).toEqual([]);
    expect(s.issues[0]).toMatchObject({ level: "blocking" });
    expect(taxStatus(both, "bimonthly")).toBe("review");
    expect(total(run([{ ...both, resolution: "payable" }], "2026-08-31"), "vat_payable")).toBe(pesos(5_000_000));
  });
  it("periodicidad distinta a la de la empresa: alerta de revisión", () => {
    const four = ret("vat", 2026, 2, "four_monthly", { payableCents: 1 });
    expect(anomalies(four, "bimonthly")[0]).toContain("cuatrimestral");
    expect(anomalies(four, null)[0]).toContain("no tiene configurada");
    expect(anomalies(four, "four_monthly")).toEqual([]);
  });
});

describe("prueba obligatoria — anticipo de renta", () => {
  const dr2024 = ret("income", 2024, null, "annual", { advanceNextCents: pesos(748_000) });
  it("DR 2024: CxC en EEFF 2025, no en 2026 ni en 2024", () => {
    expect(total(run([dr2024], "2025-12-31"), "income_advance")).toBe(pesos(748_000));
    expect(total(run([dr2024], "2026-06-30"), "income_advance")).toBe(0);
    expect(total(run([dr2024], "2024-12-31"), "income_advance")).toBe(0);
  });
});

describe("prueba obligatoria — resultados de ejercicios anteriores", () => {
  const returns = [
    ret("income", 2023, null, "annual", { incomeOrdinaryCents: pesos(24_720_000), incomeLossCents: 0 }),
    ret("income", 2024, null, "annual", { incomeOrdinaryCents: pesos(9_857_000), incomeLossCents: 0 }),
    ret("income", 2025, null, "annual", { incomeOrdinaryCents: 0, incomeLossCents: pesos(5_000_000) }),
    ret("income", 2026, null, "annual", { incomeOrdinaryCents: pesos(99_000_000), incomeLossCents: 0 }),
  ];
  it("EEFF 2026 = 24.720.000 + 9.857.000 − 5.000.000, sin el resultado de 2026", () => {
    expect(total(run(returns, "2026-12-31"), "prior_results")).toBe(pesos(24_720_000 + 9_857_000 - 5_000_000));
  });
  it("renta por pagar mientras no se pague y saldo a favor como foto de la última declaración", () => {
    const dr = [ret("income", 2024, null, "annual", { favorCents: pesos(3_000) }), ret("income", 2025, null, "annual", { payableCents: pesos(2_391_000), paymentDate: "2026-05-11" })];
    const s = run(dr, "2025-12-31");
    expect([total(s, "income_payable"), total(s, "income_favor")]).toEqual([pesos(2_391_000), 0]);
    expect(total(run(dr, "2026-06-30"), "income_payable")).toBe(0);
    expect(total(run(dr, "2024-12-31"), "income_favor")).toBe(pesos(3_000));
  });
});

describe("correcciones y PUC", () => {
  it("una declaración reemplazada no cuenta; sin PUC configurado no se envía y bloquea", () => {
    const old = ret("withholding", 2026, 9, "monthly", { payableCents: 100, supersededBy: 99 });
    const fix = ret("withholding", 2026, 9, "monthly", { payableCents: 300, isCorrection: true });
    expect(total(run([old, fix], "2026-09-30"), "withholding_payable")).toBe(300);
    expect(taxStatus(old, null)).toBe("superseded");
    const s = run([fix], "2026-09-30", { puc: new Map() });
    expect(s.effects[0].pucCode).toBeNull();
    expect(s.issues[0]).toMatchObject({ level: "blocking", message: expect.stringContaining("Retención en la fuente por pagar") });
  });
});
