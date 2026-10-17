import { describe, expect, it } from "vitest";
import { uploadCoverage } from "./coverage";
import { componentReadiness, computeEeff, eeffComponents, referenceValue, REFERENCE_ADJUSTMENT_CENTS, salesScope } from "./eeff";
import { classifyOperations } from "./classify";
import { buildOperations } from "./operations";
import { purchaseData, saleData, stored, upload } from "./testkit";

const ctx = { year: 2026, docLookup: { stored: new Map<string, string>() } };
const MILLION = 100_000_000; // $1.000.000 en centavos

/** Una compra por mes en `months` (1–12) con el valor dado; cada una de un tercero distinto para no activar duplicados. */
function purchases(uploadId: number, perMonth: Record<number, number>) {
  return Object.entries(perMonth).map(([m, amount], i) => stored(uploadId, "purchase", i + 2, purchaseData({ amount, date: `2026-${String(m).padStart(2, "0")}-10`, docType: "CC", doc: String(1000 + Number(m)), firstName: "A", firstSurname: "B" })));
}

function calc(rows: ReturnType<typeof stored>[], uploads = [upload(1, "a.xlsx")], cutoff = "2026-12-31") {
  const { operations } = classifyOperations(buildOperations(uploads, rows, ctx), []);
  const coverages = uploads.map((u) => uploadCoverage(u, operations, 2026));
  return { operations, coverages, eeff: computeEeff({ year: 2026, cutoff, operations, coverages }) };
}

describe("valor de referencia para terceros", () => {
  it("calcula todos los promedios acumulados y toma el más alto", () => {
    // Enero 100, febrero 300, marzo 200 (millones): promedios 100, 200, 200.
    const { operations } = calc(purchases(1, { 1: 100_000_000, 2: 300_000_000, 3: 200_000_000 }));
    const ref = referenceValue(2026, "2026-03-31", operations);
    expect(ref.months.map((m) => m.averageCents)).toEqual([100_000_000 * 100, 200_000_000 * 100, 200_000_000 * 100]);
    expect(ref.months.map((m) => m.cumulativeCents)).toEqual([10_000_000_000, 40_000_000_000, 60_000_000_000]);
  });

  it("el tramo ganador termina antes del corte: suma $50.000.000", () => {
    // Febrero acumulado (300+100)/2 = 200 gana frente a marzo (100+300+0)/3 ≈ 133.
    const { operations } = calc(purchases(1, { 1: 100 * MILLION / 100, 2: 300 * MILLION / 100 }));
    const ref = referenceValue(2026, "2026-03-31", operations);
    expect(ref.winnerMonth).toBe("2026-02");
    expect(ref.winnerAverageCents).toBe(200 * MILLION);
    expect(ref.adjustmentCents).toBe(REFERENCE_ADJUSTMENT_CENTS);
    expect(ref.referenceCents).toBe(200 * MILLION + REFERENCE_ADJUSTMENT_CENTS);
  });

  it("el tramo ganador termina en el mes de corte: no suma el ajuste", () => {
    const { operations } = calc(purchases(1, { 1: 10_000_000, 2: 20_000_000, 3: 90_000_000 }));
    const ref = referenceValue(2026, "2026-03-31", operations);
    expect(ref.winnerMonth).toBe("2026-03");
    expect(ref.adjustmentCents).toBe(0);
    expect(ref.referenceCents).toBe(Math.round((120_000_000 * 100) / 3));
  });

  it("en un empate se conserva el primer tramo y los meses sin compras cuentan como cero", () => {
    const { operations } = calc(purchases(1, { 1: 30_000_000, 2: 30_000_000 }));
    const ref = referenceValue(2026, "2026-02-28", operations);
    expect(ref.winnerMonth).toBe("2026-01");
    expect(ref.months).toHaveLength(2);
    const withGap = referenceValue(2026, "2026-04-30", operations);
    expect(withGap.months.map((m) => m.purchasesCents)).toEqual([3_000_000_000, 3_000_000_000, 0, 0]);
    expect(withGap.winnerMonth).toBe("2026-01");
  });

  it("solo cuenta compras aceptadas hasta el corte", () => {
    const rows = [...purchases(1, { 1: 100_000_000 }), stored(1, "purchase", 9, purchaseData({ amount: 999_000_000, date: "2025-05-05", docType: "CC", doc: "1" })), stored(1, "purchase", 10, purchaseData({ amount: 5_000_000, date: "2026-08-01", docType: "CC", doc: "2" }))];
    const { operations } = calc(rows);
    const ref = referenceValue(2026, "2026-03-31", operations);
    expect(ref.months.reduce((s, m) => s + m.purchasesCents, 0)).toBe(10_000_000_000);
  });

  it("sin compras aplicables no inventa un valor de referencia", () => {
    const ref = referenceValue(2026, "2026-06-30", []);
    expect(ref).toMatchObject({ referenceCents: 0, adjustmentCents: 0, winnerMonth: null });
  });
});

describe("ingreso propio", () => {
  it("ventas aplicables − compras aplicables", () => {
    const rows = [...purchases(1, { 1: 30_000_000, 2: 20_000_000 }), stored(1, "sale", 2, saleData({ amount: 80_000_000, docType: "NIT", doc: "800197268", business: "X" }))];
    const { eeff } = calc(rows, [upload(1, "a.xlsx")], "2026-12-31");
    expect(eeff.purchasesCents).toBe(5_000_000_000);
    expect(eeff.salesCents).toBe(8_000_000_000);
    expect(eeff.ownIncomeCents).toBe(3_000_000_000);
  });

  it("las ventas de una carga posterior al corte no cuentan", () => {
    const uploads = [upload(1, "ene.xlsx"), upload(2, "jun.xlsx")];
    const rows = [...purchases(1, { 1: 10_000_000 }), ...purchases(2, { 6: 10_000_000 }), stored(1, "sale", 2, saleData({ amount: 50_000_000, docType: "NIT", doc: "1" })), stored(2, "sale", 2, saleData({ amount: 70_000_000, docType: "NIT", doc: "2" }))];
    const { eeff } = calc(rows, uploads, "2026-03-31");
    expect(eeff.salesCents).toBe(5_000_000_000);
    expect(eeff.uploadSales.map((u) => u.scope.status)).toEqual(["included", "excluded"]);
  });

  it("si el corte cae dentro del período de una carga con ventas, no se inventa una distribución: bloquea solo lo que depende de ellas", () => {
    const rows = [...purchases(1, { 1: 10_000_000, 2: 10_000_000, 3: 10_000_000 }), stored(1, "sale", 2, saleData({ amount: 90_000_000, docType: "NIT", doc: "1" }))];
    const { eeff } = calc(rows, [upload(1, "ene-mar.xlsx")], "2026-02-15");
    expect(eeff.ownIncomeCents).toBeNull();
    expect(eeff.blockedSales[0]).toMatch(/ene-mar\.xlsx/);
    // El valor de referencia depende solo de compras: sigue calculándose.
    expect(eeff.reference.referenceCents).toBeGreaterThan(0);
    const otc = eeffComponents("otc", eeff);
    expect(otc.find((c) => c.key === "sales")?.cents).toBeNull();
    expect(otc.find((c) => c.key === "cost_of_sales")?.cents).toBe(eeff.reference.referenceCents);
    const banks = eeffComponents("banks", eeff);
    expect(banks.map((c) => [c.key, c.cents === null])).toEqual([["sales", true], ["third_income", false], ["third_cost", false]]);
  });

  it("ajustar el período de cobertura lo desbloquea", () => {
    const uploads = [upload(1, "ene-mar.xlsx", { coverageOverride: ["2026-01"] })];
    const rows = [...purchases(1, { 1: 10_000_000, 3: 10_000_000 }), stored(1, "sale", 2, saleData({ amount: 90_000_000, docType: "NIT", doc: "1" }))];
    expect(calc(rows, uploads, "2026-02-15").eeff.ownIncomeCents).not.toBeNull();
  });

  it("una carga con ventas pero sin compras con fecha no se puede ubicar", () => {
    const { eeff } = calc([stored(1, "sale", 2, saleData({ amount: 10, docType: "NIT", doc: "1" }))]);
    expect(eeff.ownIncomeCents).toBeNull();
  });

  it("alcance de las ventas frente al corte", () => {
    const cov = (first: string, last: string) => ({ uploadId: 1, fileName: "a", months: [first, last], selected: [first, last], derived: [first, last], pendingMonths: [], unmonthed: { outOfYear: 0, unreadableDate: 0, sales: 0 }, overridden: false, first, last });
    expect(salesScope(cov("2026-01", "2026-03"), "2026-03-31").status).toBe("included");
    expect(salesScope(cov("2026-01", "2026-03"), "2026-03-30").status).toBe("blocked");
    expect(salesScope(cov("2026-04", "2026-05"), "2026-03-31").status).toBe("excluded");
  });
});

describe("presentaciones", () => {
  const rows = [...purchases(1, { 1: 100_000_000, 2: 300_000_000 }), stored(1, "sale", 2, saleData({ amount: 1_000_000_000, docType: "NIT", doc: "1" }))];
  const { eeff } = calc(rows, [upload(1, "a.xlsx")], "2026-03-31");
  const own = eeff.ownIncomeCents!;
  const ref = eeff.reference.referenceCents;
  const view = (p: "otc" | "banks" | "dr") => Object.fromEntries(eeffComponents(p, eeff).map((c) => [c.key, c.cents]));

  it("OTC: ventas = ingreso propio + referencia; costo de ventas = referencia", () => {
    expect(view("otc")).toEqual({ sales: own + ref, cost_of_sales: ref });
  });
  it("Bancos: ventas = ingreso propio; ingresos y costos para terceros = referencia", () => {
    expect(view("banks")).toEqual({ sales: own, third_income: ref, third_cost: ref });
  });
  it("DR: solo ventas = ingreso propio", () => {
    expect(view("dr")).toEqual({ sales: own });
  });

  it("falta de PUC o de ubicación bloquea el componente; en cero no exige cuenta", () => {
    const comps = eeffComponents("banks", eeff);
    const checks = new Map([
      ["crypto.sales", { code: "413595", valid: true, located: true }],
      ["crypto.third_income", { code: undefined, valid: false, located: false }],
      ["crypto.third_cost", { code: "613595", valid: true, located: false }],
    ]);
    const ready = componentReadiness(comps, (k) => checks.get(k)!);
    expect(ready.map((c) => c.issue === null)).toEqual([true, false, false]);
    expect(ready[1].issue).toMatch(/Falta la cuenta PUC/);
    expect(ready[2].issue).toMatch(/ubicación/);
    const zero = componentReadiness([{ ...comps[1], cents: 0 }], () => ({ code: undefined, valid: false, located: false }));
    expect(zero[0].issue).toBeNull();
  });
});
