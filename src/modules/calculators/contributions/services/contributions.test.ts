import { describe, expect, it } from "vitest";
import {
  ARL_OPTIONS,
  calculateContributions,
  contribution,
  defaultSelection,
  DEPENDENT_LINES,
  exactContribution,
  formatCalcPesos,
  formatPercent,
  independentIbc,
  INDEPENDENT_LINES,
  parsePesosInput,
} from "./contributions";

const select = (lines: typeof DEPENDENT_LINES, picks: Record<string, number>) =>
  Object.fromEntries(lines.map((l) => [l.id, (picks[l.id] === undefined ? l.options[0] : l.options.find((o) => o.rate === picks[l.id])!).id]));

describe("calculadora de aportes — dependientes", () => {
  it("todo en cero da total $ 0", () => {
    const r = calculateContributions(2_000_000, DEPENDENT_LINES, defaultSelection(DEPENDENT_LINES));
    expect(r.totalPesos).toBe(0);
    expect(r.lines.every((l) => l.valuePesos === 0)).toBe(true);
  });

  it("solo trae Salud, Pensión, ARL, CCF, SENA e ICBF (sin FSP) con sus opciones", () => {
    expect(DEPENDENT_LINES.map((l) => l.label)).toEqual(["Salud", "Pensión", "ARL", "CCF", "SENA", "ICBF"]);
    expect(DEPENDENT_LINES.map((l) => l.options.map((o) => o.label))).toEqual([
      ["0%", "4%", "12,5%"],
      ["0%", "16%"],
      ["Ninguno — 0%", "Riesgo I — 0,522%", "Riesgo II — 1,044%", "Riesgo III — 2,436%", "Riesgo IV — 4,35%", "Riesgo V — 6,96%"],
      ["0%", "4%"],
      ["0%", "2%"],
      ["0%", "3%"],
    ]);
    expect(DEPENDENT_LINES[0].options[2].rate).toBe(0.125);
    expect(ARL_OPTIONS[1].rate).toBe(0.00522);
  });

  it("calcula cada aporte con el IBC y suma el total", () => {
    const picks = { health: 0.04, pension: 0.16, arl: 0.00522, ccf: 0.04, sena: 0.02, icbf: 0.03 };
    const r = calculateContributions(1_750_905, DEPENDENT_LINES, select(DEPENDENT_LINES, picks));
    // 70.036,2 · 280.144,8 · 9.139,72 · 70.036,2 · 35.018,1 · 52.527,15 → múltiplo de $ 100 superior.
    expect(r.lines.map((l) => l.valuePesos)).toEqual([70_100, 280_200, 9_200, 70_100, 35_100, 52_600]);
    expect(r.totalPesos).toBe(517_300);
  });

  it("IBC vacío o en cero deja todos los aportes en $ 0", () => {
    const all = select(DEPENDENT_LINES, { health: 0.125, pension: 0.16, arl: 0.0696 });
    expect(calculateContributions(null, DEPENDENT_LINES, all).totalPesos).toBe(0);
    expect(calculateContributions(0, DEPENDENT_LINES, all).totalPesos).toBe(0);
  });
});

describe("calculadora de aportes — independientes", () => {
  it("solo trae Salud, Pensión, ARL y CCF (sin FSP, SENA ni ICBF)", () => {
    expect(INDEPENDENT_LINES.map((l) => l.label)).toEqual(["Salud", "Pensión", "ARL", "CCF"]);
    expect(INDEPENDENT_LINES.map((l) => l.options.map((o) => o.label))).toEqual([["0%", "12,5%"], ["0%", "16%"], ARL_OPTIONS.map((o) => o.label), ["0%", "0,6%", "2%", "4%"]]);
  });

  it("40 % mayor al SMMLV: IBC = 40 % de los ingresos", () => {
    expect(independentIbc(10_000_000, 1_750_905)).toEqual({ status: "ok", fortyPercentPesos: 4_000_000, minimumWagePesos: 1_750_905, ibcPesos: 4_000_000, usesMinimumWage: false });
  });

  it("40 % menor al SMMLV: IBC = SMMLV", () => {
    expect(independentIbc(3_000_000, 1_750_905)).toEqual({ status: "ok", fortyPercentPesos: 1_200_000, minimumWagePesos: 1_750_905, ibcPesos: 1_750_905, usesMinimumWage: true });
  });

  it("sin ingresos no aplica el SMMLV, y sin SMMLV del año no calcula", () => {
    expect(independentIbc(null, 1_750_905)).toEqual({ status: "empty" });
    expect(independentIbc(0, 1_750_905)).toEqual({ status: "empty" });
    expect(independentIbc(5_000_000, undefined)).toEqual({ status: "missing-wage" });
  });

  it("el 40 % se aproxima al peso superior", () => {
    expect(independentIbc(10_000_001, 1_750_905)).toMatchObject({ fortyPercentPesos: 4_000_001 });
  });

  it("CCF 0,6 % sobre $ 2.000.000 da $ 12.000 exactos antes y después del redondeo", () => {
    expect(exactContribution(2_000_000, 0.006)).toBe(12_000);
    expect(contribution(2_000_000, 0.006)).toBe(12_000);
    const r = calculateContributions(2_000_000, INDEPENDENT_LINES, select(INDEPENDENT_LINES, { ccf: 0.006 }));
    expect(r.totalPesos).toBe(12_000);
  });

  it("total = Salud + Pensión + ARL + CCF con el IBC de $ 4.000.000", () => {
    const r = calculateContributions(4_000_000, INDEPENDENT_LINES, select(INDEPENDENT_LINES, { health: 0.125, pension: 0.16, arl: 0.00522, ccf: 0.02 }));
    expect(r.lines.map((l) => l.valuePesos)).toEqual([500_000, 640_000, 20_900, 80_000]);
    expect(r.totalPesos).toBe(1_240_900);
  });
});

describe("ARL", () => {
  it("aplica cada nivel de riesgo sobre el IBC", () => {
    expect(ARL_OPTIONS.map((o) => exactContribution(2_000_000, o.rate))).toEqual([0, 10_440, 20_880, 48_720, 87_000, 139_200]);
    expect(ARL_OPTIONS.map((o) => contribution(1_750_905, o.rate))).toEqual([0, 9_200, 18_300, 42_700, 76_200, 121_900]);
  });
});

describe("formatos y entrada", () => {
  it("muestra porcentajes y pesos en formato colombiano", () => {
    expect([0.125, 0.00522, 0.01044, 0.02436, 0.0435, 0.0696, 0.006, 0.16, 0].map(formatPercent)).toEqual(["12,5%", "0,522%", "1,044%", "2,436%", "4,35%", "6,96%", "0,6%", "16%", "0%"]);
    expect([1_750_905, 70_100, 0].map(formatCalcPesos)).toEqual(["$ 1.750.905", "$ 70.100", "$ 0"]);
  });

  it("acepta solo dígitos: sin letras, negativos ni decimales", () => {
    expect(parsePesosInput("1705905")).toBe(1_705_905);
    expect(parsePesosInput("$ 1.705.905")).toBe(1_705_905);
    expect(parsePesosInput("-12a3")).toBe(123);
    expect(parsePesosInput("")).toBeNull();
    expect(parsePesosInput("abc")).toBeNull();
    expect(parsePesosInput("0001")).toBe(1);
    expect(parsePesosInput("1234567890123456")).toBe(123_456_789_012);
  });
});
