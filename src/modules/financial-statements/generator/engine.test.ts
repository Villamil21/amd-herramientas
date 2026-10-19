import { describe, expect, it } from "vitest";
import type { BankBalance, FsCatalog, FsLine, FsPucMapping, FsSectionKey, Movement } from "../../../types/fs";
import { formatStatementPesos, roundThousands, estimatedIncomeTax } from "../shared/money";
import { TAX_PUC, type TaxReturn } from "../tax-obligations/types";
import { checklist, pendingBalanceText } from "./checks";
import { buildStatements, eerrRows, esfRows, isBalanced, pendingBankBalances, reclassificationAges, type EngineInput } from "./engine";

// Catálogo inicial (el mismo de la migración 014).
const SEED: [number, FsSectionKey, string, FsLine["role"]][] = [
  [1, "asset_current", "Disponible", null],
  [2, "asset_current", "Activos intangibles", null],
  [3, "asset_noncurrent", "Propiedades, planta y equipo", null],
  [4, "liability_current", "Obligaciones financieras", null],
  [5, "liability_current", "Proveedores", null],
  [6, "liability_current", "Cuentas por pagar", null],
  [8, "liability_current", "Obligaciones laborales", null],
  [13, "liability_noncurrent", "Otros pasivos", null],
  [14, "equity", "Capital social", "share_capital"],
  [16, "equity", "Resultados del ejercicio", "period_result"],
  [17, "equity", "Resultados de ejercicios anteriores", null],
  [18, "income", "Ventas", "sales"],
  [19, "income", "Ingresos para terceros", "third_party_income"],
  [20, "income", "Devoluciones y Descuentos", null],
  [21, "costs", "Costo de Ventas", "cost_of_sales"],
  [22, "costs", "Costo de terceros", "third_party_cost"],
  [23, "admin_expenses", "Gastos de personal", null],
  [26, "admin_expenses", "Servicios", null],
  [28, "admin_expenses", "Diversos", null],
  [31, "sales_expenses", "Diversos", null],
  [32, "other_income", "Otros Ingresos", null],
  [33, "other_expenses", "Otros Gastos", null],
  [34, "other_expenses", "Otros Gastos financieros", null],
  // Contrapartes no corrientes (mismo nombre que la línea corriente).
  [35, "liability_noncurrent", "Cuentas por pagar", null],
  [36, "asset_noncurrent", "Activos intangibles", null],
  [37, "asset_current", "Deudores", null],
  [38, "asset_noncurrent", "Deudores", null],
];

const catalog: FsCatalog = {
  lines: SEED.map(([id, section, name, role], i) => ({ id, section, name, role, sortOrder: i, isActive: true, hasHistory: false })),
  sections: [
    { section: "asset_current", representativeLineId: 1 },
    { section: "asset_noncurrent", representativeLineId: 3 },
    { section: "liability_current", representativeLineId: 6 },
    { section: "liability_noncurrent", representativeLineId: 13 },
    { section: "equity", representativeLineId: 14 },
    { section: "income", representativeLineId: 18 },
    { section: "costs", representativeLineId: 21 },
    { section: "admin_expenses", representativeLineId: 28 },
    { section: "sales_expenses", representativeLineId: 31 },
    { section: "other_income", representativeLineId: 32 },
    { section: "other_expenses", representativeLineId: 33 },
  ],
};

const map = (pucCode: string, lineId: number | null, excluded = false): FsPucMapping => ({ pucCode, lineId, excluded, updatedAt: "", origin: "manual" });

const MAPPINGS: FsPucMapping[] = [
  map("111005", 1),
  map("110505", 1),
  map("132505", 2),
  map("220505", 5),
  map("251010", 8),
  map("370505", 17),
  map("413595", 18),
  map("417505", 20),
  map("510506", 23),
  map("513595", 26),
  map("530505", 34),
  map("421005", 32),
  map("7305", null, true),
];

let nextId = 1;
function mv(date: string, pucCode: string, pesos: number, extra: Partial<Movement> = {}): Movement {
  return {
    id: nextId++,
    companyId: 1,
    batchId: 1,
    accountingDate: date,
    source: "purchases",
    conceptKey: "",
    documentId: "",
    documentNumber: "",
    documentType: "",
    supplierId: null,
    supplierNit: "",
    supplierName: "",
    employeeId: null,
    employmentId: null,
    bank: "",
    accountNumber: "",
    pucCode,
    pucConcept: pucCode,
    description: "",
    amountCents: Math.round(pesos * 100),
    dc: null,
    settlesOn: null,
    status: "active",
    detail: null,
    createdAt: "",
    ...extra,
  };
}

const NO_CAPITAL = { subscribedTotalShares: null, subscribedNominalValue: null, paidTotalShares: null, paidNominalValue: null };

function run(partial: Partial<EngineInput>) {
  return buildStatements({ company: NO_CAPITAL, catalog, mappings: MAPPINGS, movements: [], bankBalances: [], start: "2026-01-01", end: "2026-08-31", presentation: "bank", ...partial });
}

const line = (rows: ReturnType<typeof esfRows>, label: string) => rows.filter((r) => r.label === label);
const balance = (date: string, pesos: number, id: number): BankBalance => ({ id, batchId: id, bank: "BBVA", accountNumber: "7491", balanceDate: date, balanceCents: pesos * 100, pucCode: "111005", active: true });

describe("redondeo y formato", () => {
  it("redondea al millar con la mitad hacia arriba, también en negativos", () => {
    expect([3_566_281, 3_566_499, 3_566_500].map((p) => roundThousands(p * 100))).toEqual([3_566_000, 3_566_000, 3_567_000]);
    expect(roundThousands(-356_650_000)).toBe(-3_567_000);
    expect(roundThousands(49_999)).toBe(0);
  });

  it("negativos entre paréntesis y ceros como guion", () => {
    expect(formatStatementPesos(-2_000_000)).toBe("($2.000.000)");
    expect(formatStatementPesos(0)).toBe("-");
    expect(formatStatementPesos(3_566_000)).toBe("$3.566.000");
  });

  it("impuesto estimado: 35 % del resultado positivo al millar; cero o pérdida → 0", () => {
    expect(estimatedIncomeTax(1_018_937_500)).toBe(3_566_000);
    expect(estimatedIncomeTax(0)).toBe(0);
    expect(estimatedIncomeTax(-50_000_000)).toBe(0);
  });

  it("los totales se calculan con valores exactos y luego se redondean", () => {
    const s = run({ movements: [mv("2026-02-01", "513595", 1_400), mv("2026-03-01", "510506", 1_400)] });
    // Cada línea redondeada es 1.000; el total exacto 2.800 → 3.000 (no 2.000).
    const rows = eerrRows(s);
    expect(line(rows, "Servicios")[0].pesos).toBe(1_000);
    expect(line(rows, "TOTAL GASTOS OPERACIONALES ADMINISTRACIÓN")[0].pesos).toBe(3_000);
  });
});

describe("Estado de Situación Financiera", () => {
  it("saldo bancario: la foto del mes final, nunca la suma de meses", () => {
    const bankBalances = [balance("2026-08-31", 265_740_263, 1), balance("2026-09-30", 310_000_000, 2)];
    const aug = run({ bankBalances, end: "2026-08-31" });
    const sep = run({ bankBalances, end: "2026-09-30" });
    expect(aug.sections.asset_current.totalCents).toBe(26_574_026_300);
    expect(sep.sections.asset_current.totalCents).toBe(31_000_000_000);
    expect(pendingBankBalances(sep)).toEqual([]);
    // Un lote reemplazado ya no cuenta.
    expect(run({ bankBalances: [balance("2026-08-31", 1, 1), { ...balance("2026-08-31", 9, 2), active: false }] }).esf.currentAssets).toBe(100);
  });

  it("prueba 1 de saldos: septiembre $100.000.000 y agosto $80.000.000 → usa septiembre", () => {
    const s = run({ bankBalances: [balance("2026-08-31", 80_000_000, 1), balance("2026-09-30", 100_000_000, 2)], end: "2026-09-30" });
    expect(s.esf.currentAssets).toBe(10_000_000_000);
  });

  it("prueba 2 de saldos: solo agosto → septiembre pendiente, agosto solo como referencia", () => {
    const s = run({ bankBalances: [balance("2026-07-31", 70_000_000, 1), balance("2026-08-31", 80_000_000, 2)], end: "2026-09-30" });
    expect(s.esf.currentAssets).toBe(0);
    expect(s.pucBalances.has("111005")).toBe(false);
    const [pending] = pendingBankBalances(s);
    expect([pending.month, pending.balance, pending.lastKnown?.balanceDate]).toEqual(["2026-09", null, "2026-08-31"]);
  });

  it("prueba 3 de saldos: cada cuenta por separado (A con septiembre, B pendiente)", () => {
    const a = { ...balance("2026-09-30", 100_000_000, 1), bank: "Bancolombia", accountNumber: "1234" };
    const b = { ...balance("2026-08-31", 80_000_000, 2), accountNumber: "7491" };
    const s = run({ bankBalances: [a, b], end: "2026-09-30" });
    expect(s.esf.currentAssets).toBe(10_000_000_000);
    expect(s.bankBalances.map((x) => [x.bank, x.balance?.balanceCents ?? null])).toEqual([["Bancolombia", 10_000_000_000], ["BBVA", null]]);
    expect(pendingBankBalances(s).map((x) => x.accountNumber)).toEqual(["7491"]);
    const item = checklist(s, s, [], [], 0).find((c) => c.id === "bankBalance")!;
    expect([item.ok, item.detail]).toEqual([false, "Falta saldo bancario del mes final: BBVA ••••7491"]);
    expect(pendingBalanceText(pendingBankBalances(s)[0])).toBe("BBVA ••••7491: no existe saldo final de septiembre de 2026. Último saldo disponible: agosto de 2026.");
  });

  it("saldo del mes final aunque la fecha final sea a mitad de mes; una cuenta que aún no existía no se exige", () => {
    const s = run({ bankBalances: [balance("2026-09-30", 5, 1), { ...balance("2026-10-31", 9, 2), accountNumber: "nueva" }], end: "2026-09-15" });
    expect(s.esf.currentAssets).toBe(500);
    expect(s.bankBalances).toHaveLength(1);
  });

  it("capital social desde Empresas y la diferencia suscrito − pagado en el PUC configurado", () => {
    const s = run({ company: { subscribedTotalShares: 2_000, subscribedNominalValue: 1_000, paidTotalShares: 1_500, paidNominalValue: 1_000 }, capitalReceivablePuc: "132505" });
    const equity = s.sections.equity.lines.find((l) => l.line.role === "share_capital")!;
    expect(equity.cents).toBe(200_000_000);
    expect(s.pucBalances.get("132505")).toBe(50_000_000);
    expect(s.sociosReceivableCents).toBe(50_000_000);
    expect(isBalanced(s)).toBe(false);
    // Suscrito = pagado: sin saldo en 132505.
    expect(run({ company: { subscribedTotalShares: 2_000, subscribedNominalValue: 1_000, paidTotalShares: 2_000, paidNominalValue: 1_000 }, capitalReceivablePuc: "132505" }).pucBalances.has("132505")).toBe(false);
  });

  it("la CxC a socios sin PUC no entra a EEFF y queda como pendiente bloqueante; sin ubicación tampoco", () => {
    const company = { subscribedTotalShares: 2_000, subscribedNominalValue: 1_000, paidTotalShares: 1_500, paidNominalValue: 1_000 };
    const none = run({ company, capitalReceivablePuc: null });
    expect(none.pucBalances.has("132505")).toBe(false);
    expect(none.sociosReceivableCents).toBe(0);
    expect(none.tax.issues).toEqual([expect.objectContaining({ level: "blocking", taxType: "capital", pucKey: "capital.receivable" })]);
    // Con PUC pero sin línea del ESF: queda sin clasificar (por su grupo de cuatro dígitos) y no entra.
    const unmapped = run({ company, capitalReceivablePuc: "133010" });
    expect(unmapped.sociosReceivableCents).toBe(0);
    expect(unmapped.unclassified).toEqual([expect.objectContaining({ pucCode: "1330", cents: 50_000_000 })]);
  });

  it("la ubicación en EEFF de un PUC puede configurarse por familia de cuatro dígitos", () => {
    const familyOnly = MAPPINGS.filter((m) => m.pucCode !== "132505").concat(map("1325", 2));
    const s = run({ mappings: familyOnly, company: { subscribedTotalShares: 2_000, subscribedNominalValue: 1_000, paidTotalShares: 1_500, paidNominalValue: 1_000 }, capitalReceivablePuc: "132510" });
    expect(s.sociosReceivableCents).toBe(50_000_000);
    expect(s.unclassified).toHaveLength(0);
  });

  it("resultados anteriores negativos siguen en Patrimonio, en negativo", () => {
    const s = run({ movements: [mv("2025-12-31", "370505", -2_000_000, { source: "opening" })] });
    const row = line(esfRows(s), "Resultados de ejercicios anteriores")[0];
    expect(row.pesos).toBe(-2_000_000);
    expect(formatStatementPesos(row.pesos!)).toBe("($2.000.000)");
  });

  it("el resultado del ejercicio es el RESULTADO ANTES DE IMPUESTOS (también si es pérdida)", () => {
    const s = run({ movements: [mv("2026-03-01", "513595", 500_000)] });
    expect(s.eerr.beforeTax).toBe(-50_000_000);
    expect(line(esfRows(s), "Resultados del ejercicio")[0].pesos).toBe(-500_000);
  });

  it("cuadra solo si Activo = Pasivo + Patrimonio", () => {
    const opening = [mv("2025-12-31", "110505", 10_000_000, { source: "opening" }), mv("2025-12-31", "370505", 10_000_000, { source: "opening" })];
    expect(isBalanced(run({ movements: opening }))).toBe(true);
    const off = run({ movements: [...opening, mv("2026-05-01", "220505", 1_000)] });
    expect(off.esf.differenceCents).toBe(-100_000);
  });

  it("cuentas por pagar: existen al corte solo si se pagan después de la fecha final", () => {
    const movements = [mv("2026-08-31", "251010", 300_000, { settlesOn: "2026-09-10" }), mv("2026-07-31", "251010", 200_000, { settlesOn: "2026-08-10" }), mv("2026-08-31", "251010", 50_000, { settlesOn: null })];
    expect(run({ movements }).esf.currentLiabilities).toBe(35_000_000);
    expect(run({ movements, end: "2026-09-30" }).esf.currentLiabilities).toBe(5_000_000);
  });

  it("datos fuera del rango se guardan pero no cuentan", () => {
    const movements = [mv("2026-08-15", "513595", 1_000), mv("2026-09-15", "513595", 7_000), mv("2025-12-15", "513595", 9_000)];
    expect(run({ movements }).eerr.admin).toBe(100_000);
  });
});

describe("clasificación", () => {
  it("un PUC con movimientos y sin destino queda pendiente; 7305 no aparece ni bloquea", () => {
    const s = run({ movements: [mv("2026-03-01", "519595", 1_000), mv("2026-03-02", "7305", 9_999)] });
    expect(s.unclassified.map((u) => [u.pucCode, u.cents])).toEqual([["5195", 100_000]]);
    expect(s.eerr.admin + s.eerr.sales + s.esf.assets).toBe(0);
  });

  it("una línea desactivada no se pierde: su PUC vuelve a pendiente", () => {
    const off: FsCatalog = { ...catalog, lines: catalog.lines.map((l) => (l.id === 26 ? { ...l, isActive: false } : l)) };
    const s = run({ catalog: off, movements: [mv("2026-03-01", "513595", 1_000)] });
    expect(s.unclassified[0]).toMatchObject({ pucCode: "5135", inactiveLine: "Servicios" });
  });

  it("extractos: el signo lo da la naturaleza de la sección destino", () => {
    const s = run({
      movements: [
        mv("2026-08-31", "530505", 20_000, { source: "bank", dc: "D" }), // comisión: gasto financiero +
        mv("2026-08-31", "421005", 3_000, { source: "bank", dc: "C" }), // intereses recibidos: ingreso +
        mv("2026-08-31", "220505", 50_000, { source: "bank", dc: "D" }), // pago a proveedor: pasivo −
      ],
    });
    expect([s.eerr.otherExpenses, s.eerr.otherIncome, s.esf.currentLiabilities]).toEqual([2_000_000, 300_000, -5_000_000]);
  });

  describe("gasto bancario = salidas − entradas", () => {
    const bank = (pesos: number, dc: "D" | "C", pucCode = "530505") => mv("2026-08-31", pucCode, pesos, { source: "bank", dc, pucConcept: "COMISIONES" });
    it.each([
      ["prueba 1: solo cargos", [bank(41_650, "D")], 4_165_000],
      ["prueba 2: cargo y devolución parcial", [bank(100_000, "D"), bank(30_000, "C")], 7_000_000],
      ["prueba 3: devolución mayor que los cargos", [bank(20_000, "D"), bank(50_000, "C")], -3_000_000],
    ])("%s", (_, movements, expected) => {
      const s = run({ movements });
      expect(s.eerr.otherExpenses).toBe(expected);
      // Sin clasificar se muestra con el mismo signo contable (naturaleza débito de la clase 5).
      const unmapped = run({ movements: movements.map((m) => ({ ...m, pucCode: "529595" })) });
      expect(unmapped.unclassified.map((u) => [u.pucCode, u.cents])).toEqual([["5295", expected]]);
    });

    it("COMISIONES: dos salidas de $20.825 → +$41.650 en «Códigos PUC sin clasificar»", () => {
      const s = run({ movements: [mv("2026-08-31", "529595", 41_650, { source: "bank", dc: "D", pucConcept: "COMISIONES", detail: { count: 2 } })] });
      expect(s.unclassified[0]).toMatchObject({ concept: "COMISIONES", cents: 4_165_000 });
    });

    it("sin clasificar: una entrada a un PUC de ingreso o pasivo es positiva", () => {
      const s = run({ movements: [mv("2026-08-31", "429595", 3_000, { source: "bank", dc: "C" }), mv("2026-08-31", "238095", 1_000, { source: "bank", dc: "C" })] });
      expect(s.unclassified.map((u) => u.cents)).toEqual([100_000, 300_000]);
    });
  });

  it("líneas en cero ocultas; sección vacía muestra su cuenta representativa en 0", () => {
    const rows = esfRows(run({ movements: [mv("2025-12-31", "110505", 5_000, { source: "opening" })] }));
    expect(line(rows, "Activos intangibles")).toHaveLength(0);
    expect(line(rows, "Propiedades, planta y equipo")[0].pesos).toBe(0);
    expect(line(rows, "TOTAL ACTIVO NO CORRIENTE")).toHaveLength(1);
    expect(line(rows, "Cuentas por pagar")[0].pesos).toBe(0);
  });
});

describe("reporte de operaciones: Banco y OTC", () => {
  const tpsv = (date: string, kind: "buy" | "sell", pesos: number) => mv(date, kind === "buy" ? "620505" : "413595", pesos, { source: "sales_tpsv", conceptKey: `tpsv.${kind}` });
  const movements = [tpsv("2026-01-10", "sell", 5_000), tpsv("2026-02-10", "sell", 3_000), tpsv("2026-04-10", "sell", 4_000), tpsv("2026-01-10", "buy", 11_100), tpsv("2026-09-10", "sell", 99_999)];

  it("promedio mensual con los meses sin ventas en 0", () => {
    const s = run({ movements, end: "2026-04-30" });
    expect(s.crypto.months.map((m) => m.sellsCents / 100)).toEqual([5_000, 3_000, 0, 4_000]);
    expect(s.crypto.monthlyAverageCents).toBe(300_000);
    expect(s.crypto.ownResultCents).toBe(90_000);
  });

  it("Banco: Ventas = resultado propio; ingresos y costo de terceros = el promedio", () => {
    const rows = eerrRows(run({ movements, end: "2026-04-30", presentation: "bank" }));
    expect(line(rows, "Ventas")[0].cents).toBe(90_000);
    expect(line(rows, "Ingresos para terceros")[0].cents).toBe(300_000);
    expect(line(rows, "Costo de terceros")[0].cents).toBe(300_000);
  });

  it("OTC: Ventas = propio + terceros; Costo de Ventas = terceros; sin líneas de terceros", () => {
    const rows = eerrRows(run({ movements, end: "2026-04-30", presentation: "otc" }));
    expect(line(rows, "Ventas")[0].cents).toBe(390_000);
    expect(line(rows, "Costo de Ventas")[0].cents).toBe(300_000);
    expect(line(rows, "Ingresos para terceros")).toHaveLength(0);
    expect(line(rows, "Costo de terceros")).toHaveLength(0);
  });

  it("el RESULTADO ANTES DE IMPUESTOS es el mismo en ambas presentaciones", () => {
    const all = [...movements, mv("2026-03-01", "513595", 25), mv("2026-03-02", "413595", 1_000, { source: "sales_einvoice" })];
    const bank = run({ movements: all, end: "2026-04-30", presentation: "bank" });
    const otc = run({ movements: all, end: "2026-04-30", presentation: "otc" });
    expect(bank.eerr.beforeTax).toBe(otc.eerr.beforeTax);
    expect(bank.eerr.beforeTax).toBe(90_000 + 100_000 - 2_500);
  });
});

describe("obligaciones tributarias en el ESF", () => {
  const base = { companyId: 1, previousFormNumber: "", isCorrection: false, supersededBy: null, favorCents: 0, resolution: "", nit: "", companyName: "", fileName: "", detail: {}, createdAt: "", updatedAt: "", events: [] as TaxReturn["events"], payments: [] as TaxReturn["payments"] };
  const paidOn = (paymentDate: string, amountCents: number): TaxReturn["payments"] => [{ id: amountCents, returnId: 0, paymentDate, amountCents, note: "", reference: "", excessCents: 0, excessKind: "", excessReview: null, createdAt: "", updatedAt: "" }];
  const retefuente = { ...base, id: 1, taxType: "withholding", year: 2026, period: 9, periodicity: "monthly", periodStart: "2026-09-01", periodEnd: "2026-09-30", formNumber: "1", payableCents: 62_400_000, payments: paidOn("2026-10-15", 62_400_000), incomeOrdinaryCents: null, incomeLossCents: null, advanceNextCents: null, advanceTargetYear: null } as TaxReturn;
  const renta = { ...base, id: 2, taxType: "income", year: 2025, period: null, periodicity: "annual", periodStart: "2025-01-01", periodEnd: "2025-12-31", formNumber: "2", payableCents: 0, incomeOrdinaryCents: 1_966_200_000, incomeLossCents: 0, advanceNextCents: 0, advanceTargetYear: 2026 } as TaxReturn;
  const puc = new Map([[TAX_PUC.withholdingPayable, "236540"], [TAX_PUC.priorResults, "370505"]]);
  const tax = { returns: [retefuente, renta], puc, vatPeriodicity: null };
  const mappings = [...MAPPINGS, map("236540", 6)];

  it("la retefuente por pagar entra al pasivo hasta su pago y el resultado fiscal a ejercicios anteriores", () => {
    const sep = run({ tax, mappings, end: "2026-09-30" });
    expect(sep.esf.currentLiabilities).toBe(62_400_000);
    expect(sep.sections.equity.lines.find((l) => l.line.id === 17)!.cents).toBe(1_966_200_000);
    expect(checklist(sep, sep, [], [], 0).find((c) => c.id === "tax")!.ok).toBe(true);
    expect(run({ tax, mappings, end: "2026-10-31" }).esf.currentLiabilities).toBe(0);
    expect(run({ tax, mappings, end: "2026-08-31" }).esf.currentLiabilities).toBe(0);
  });

  describe("prueba obligatoria — Retefuente corriente / no corriente según el año", () => {
    const ret = (id: number, year: number, period: number, paymentDate: string | null) => {
      const month = String(period).padStart(2, "0");
      return { ...retefuente, id, year, period, periodStart: `${year}-${month}-01`, periodEnd: `${year}-${month}-28`, formNumber: String(id), payableCents: 100_000_000, payments: paymentDate ? paidOn(paymentDate, 100_000_000) : [] };
    };
    const runWith = (returns: TaxReturn[]) => run({ tax: { ...tax, returns }, mappings, end: "2026-08-31" });

    it("caso 1: diciembre 2025 pendiente al 31/08/2026 → pasivo no corriente (el PUC no cambia)", () => {
      const s = runWith([ret(10, 2025, 12, null)]);
      expect([s.esf.currentLiabilities, s.esf.nonCurrentLiabilities]).toEqual([0, 100_000_000]);
      const line = s.sections.liability_noncurrent.lines.find((l) => l.cents !== 0)!;
      expect(line.contributions.map((c) => c.pucCode)).toEqual(["236540"]);
      expect(line.automatic).toContain("no corriente");
      expect(line.automatic).toContain("236540");
    });

    it("caso 2: julio 2026 pendiente → pasivo corriente", () => {
      const s = runWith([ret(11, 2026, 7, null)]);
      expect([s.esf.currentLiabilities, s.esf.nonCurrentLiabilities]).toEqual([100_000_000, 0]);
    });

    it("caso 3: Retefuente 2025 pagada el 15/01/2026 → no aparece como CxP", () => {
      const s = runWith([ret(12, 2025, 12, "2026-01-15")]);
      expect([s.esf.currentLiabilities, s.esf.nonCurrentLiabilities]).toEqual([0, 0]);
    });
  });

  describe("pruebas 09 — PUC por concepto, sanciones, excedentes y presentación por familia", () => {
    const casillas = { "44": 94_100_000, "129": 31_700_000, "130": 62_400_000, "137": 5_000_000, "138": 67_400_000 };
    const septiembre = { ...retefuente, id: 30, payableCents: 67_400_000, payments: [], detail: { withholding: { casillas }, manual: { adjustments129: [{ id: "a", conceptKey: "services", cents: 31_700_000, note: "" }] } } } as TaxReturn;
    const conceptPuc = new Map<string, string>([
      ["tax.wh.services", "236525"],
      ["tax.sanction.payable.withholding", "236595"],
      ["tax.sanction.expense.withholding", "531520"],
      ["tax.interest.expense", "530520"],
      ["tax.excess.favor", "135515"],
    ]);
    // Ubicación por familia de cuatro dígitos: 2365 → Cuentas por pagar, 5315 → Gastos diversos (sin mapear cada subcuenta).
    const familyMappings = [...MAPPINGS, map("2365", 6), map("5315", 28), map("5305", 33), map("1355", 2)];
    const go = (over: Partial<EngineInput> = {}) => run({ tax: { returns: [septiembre], puc: conceptPuc, vatPeriodicity: null }, mappings: familyMappings, start: "2026-01-01", end: "2026-09-30", ...over });

    it("las subcuentas de la misma familia comparten ubicación y el pasivo suma concepto + sanción", () => {
      const s = go();
      expect(s.unclassified).toHaveLength(0);
      // Servicios 941.000 − devolución 317.000 = 624.000 y la sanción por pagar 50.000, ambos en «Cuentas por pagar» (familia 2365).
      expect(s.esf.currentLiabilities).toBe(67_400_000);
      const line = s.sections.liability_current.lines.find((l) => l.line.id === 6)!;
      expect(line.contributions.map((c) => [c.pucCode, c.cents])).toEqual([["236525", 62_400_000], ["236595", 5_000_000]]);
      expect(line.contributions[0].concept).toContain("Servicios");
    });

    it("la sanción es gasto del periodo en que se presenta (EERR) y no entra a un rango anterior", () => {
      expect(go().eerr.otherExpenses + go().eerr.admin).toBe(5_000_000);
      expect(go({ start: "2026-10-01", end: "2026-10-31" }).eerr.admin).toBe(0);
    });

    it("sin el PUC de gasto de la sanción: la cuenta por pagar entra, el gasto queda pendiente y bloquea", () => {
      const puc = new Map(conceptPuc);
      puc.delete("tax.sanction.expense.withholding");
      const s = go({ tax: { returns: [septiembre], puc, vatPeriodicity: null } });
      expect(s.esf.currentLiabilities).toBe(67_400_000);
      expect(s.eerr.admin + s.eerr.otherExpenses).toBe(0);
      expect(s.tax.issues.some((i) => i.pucKey === "tax.sanction.expense.withholding")).toBe(true);
      expect(checklist(s, s, [], [], 0).find((c) => c.id === "tax")!.ok).toBe(false);
    });

    it("un PUC de la familia sin ubicación queda UNA vez «sin clasificar» por su familia de cuatro dígitos", () => {
      const s = go({ mappings: MAPPINGS });
      expect(s.unclassified.map((u) => u.pucCode).sort()).toEqual(["2365", "5315"]);
    });

    it("excedente a favor aprobado de un año anterior → deudor NO corriente; sin aprobar no entra", () => {
      const excessReturn = (review: TaxReturn["payments"][number]["excessReview"]): TaxReturn =>
        ({ ...septiembre, id: 31, year: 2025, period: 12, periodStart: "2025-12-01", periodEnd: "2025-12-31", formNumber: "31", payableCents: 10_000_000, detail: {}, payments: [{ id: 9, returnId: 31, paymentDate: "2026-01-10", amountCents: 10_000_000, excessCents: 2_000_000, excessKind: "favor", excessReview: review, note: "", reference: "", createdAt: "", updatedAt: "" }] }) as TaxReturn;
      const fingerprint = "9|2026-01-10|2000000|favor|135515";
      const approved = go({ tax: { returns: [excessReturn({ decision: "applies", fingerprint, decidedAt: "x" })], puc: conceptPuc, vatPeriodicity: null } });
      expect([approved.esf.currentAssets, approved.esf.nonCurrentAssets]).toEqual([0, 2_000_000]);
      const pending = go({ tax: { returns: [excessReturn(null)], puc: conceptPuc, vatPeriodicity: null } });
      expect(pending.esf.nonCurrentAssets).toBe(0);
      expect(checklist(pending, pending, [], [], 0).find((c) => c.id === "tax")!.ok).toBe(false);
    });
  });

  it("sin la cuenta PUC configurada no se envía y bloquea la lista de verificación", () => {
    const s = run({ tax: { ...tax, puc: new Map() }, mappings, end: "2026-09-30" });
    expect(s.esf.currentLiabilities).toBe(0);
    expect(checklist(s, s, [], [], 0).find((c) => c.id === "tax")!.ok).toBe(false);
  });
});

describe("clasificación por grupo de cuatro dígitos", () => {
  const familyMv = (code: string, pesos: number) => mv("2026-03-01", code, pesos, { pucConcept: `CONCEPTO ${code}` });
  const movements = [familyMv("237005", 1_000), familyMv("237006", 2_000), familyMv("237010", 3_000), familyMv("237005", 500)];

  it("2370 con varios PUC de seis dígitos es UNA fila con el total y las subcuentas de trazabilidad", () => {
    const s = run({ movements });
    expect(s.unclassified).toHaveLength(1);
    const group = s.unclassified[0];
    expect([group.pucCode, group.count, group.cents]).toEqual(["2370", 4, 650_000]);
    expect(group.children.map((c) => [c.pucCode, c.count, c.cents])).toEqual([["237005", 2, 150_000], ["237006", 1, 200_000], ["237010", 1, 300_000]]);
    expect(group.children[0].entries).toHaveLength(2);
    expect(group.children[0].entries[0]).toMatchObject({ date: "2026-03-01", cents: 100_000 });
  });

  it("clasificar el grupo se aplica a todos los hijos, también a movimientos futuros", () => {
    const grouped = [...MAPPINGS, map("2370", 6)];
    const s = run({ mappings: grouped, movements });
    expect(s.unclassified).toHaveLength(0);
    expect(s.esf.currentLiabilities).toBe(650_000);
    expect([...s.pucBalances.keys()].filter((k) => k.startsWith("2370"))).toEqual(["237005", "237006", "237010"]);
    // Un hijo que aún no existía hereda la decisión del grupo.
    expect(run({ mappings: grouped, movements: [familyMv("237099", 7_000)] }).esf.currentLiabilities).toBe(700_000);
  });

  it("clasificaciones antiguas que coinciden valen como la del grupo; las demás subcuentas la heredan", () => {
    const legacy = [...MAPPINGS, map("237005", 6), map("237006", 6)];
    const s = run({ mappings: legacy, movements });
    expect(s.unclassified).toHaveLength(0);
    expect(s.mappingConflicts).toHaveLength(0);
    expect(s.esf.currentLiabilities).toBe(650_000);
  });

  it("clasificaciones antiguas distintas en el mismo grupo: conflicto visible, nada se sobrescribe y bloquea", () => {
    const legacy = [...MAPPINGS, map("237005", 6), map("237006", 5)];
    const s = run({ mappings: legacy, movements });
    expect(s.mappingConflicts).toEqual([
      expect.objectContaining({
        family: "2370",
        options: [expect.objectContaining({ lineId: 6, label: "Cuentas por pagar", codes: ["237005"] }), expect.objectContaining({ lineId: 5, label: "Proveedores", codes: ["237006"] })],
      }),
    ]);
    // Cada subcuenta conserva su decisión anterior; la que no tenía sigue pendiente (no se inventa una decisión).
    expect(s.sections.liability_current.lines.find((l) => l.line.id === 6)!.cents).toBe(150_000);
    expect(s.sections.liability_current.lines.find((l) => l.line.id === 5)!.cents).toBe(200_000);
    expect(s.unclassified.map((u) => [u.pucCode, u.cents])).toEqual([["2370", 300_000]]);
    const check = checklist(s, s, [], [], 0).find((c) => c.id === "mappingConflicts")!;
    expect(check.ok).toBe(false);
    // Al resolver desde el grupo (la decisión del grupo reemplaza a las subcuentas) el conflicto desaparece.
    const resolved = run({ mappings: [...MAPPINGS, map("2370", 6)], movements });
    expect(resolved.mappingConflicts).toHaveLength(0);
    expect(checklist(resolved, resolved, [], [], 0).find((c) => c.id === "mappingConflicts")!.ok).toBe(true);
  });

  it("un grupo con decisión propia y una subcuenta antigua distinta también es conflicto", () => {
    const s = run({ mappings: [...MAPPINGS, map("2370", 6), map("237006", 5)], movements });
    expect(s.mappingConflicts.map((c) => c.family)).toEqual(["2370"]);
  });
});

describe("reclasificación automática corriente → no corriente", () => {
  const grouped = [...MAPPINGS, map("2370", 6), map("1305", 37)];
  const payable = (date: string, pesos: number, extra: Partial<Movement> = {}) => mv(date, "237005", pesos, extra);

  it("pasivo originado en 2025 se presenta en «Cuentas por pagar» no corriente al generar 2026, sin tocar el PUC", () => {
    const s = run({ mappings: grouped, movements: [payable("2025-11-10", 1_000, { documentNumber: "F-1", source: "purchases" })] });
    expect([s.esf.currentLiabilities, s.esf.nonCurrentLiabilities]).toEqual([0, 100_000]);
    const target = s.sections.liability_noncurrent.lines.find((l) => l.cents !== 0)!;
    expect(target.line.name).toBe("Cuentas por pagar"); // mismo nombre, solo cambia la sección
    expect(target.line.id).toBe(35);
    expect(target.contributions).toEqual([expect.objectContaining({ pucCode: "237005", cents: 100_000 })]);
    expect(target.automatic).toContain("2026");
    expect(s.reclassifications).toEqual([
      expect.objectContaining({ lineId: 6, targetLineId: 35, pucCode: "237005", originDate: "2025-11-10", originYear: 2025, ageYears: 1, document: "F-1", originalCents: 100_000, appliedCents: 0, pendingCents: 100_000 }),
    ]);
    expect(reclassificationAges(s.reclassifications)).toEqual([{ originYear: 2025, ageYears: 1, cents: 100_000, count: 1 }]);
    expect(isBalanced(s) || s.esf.assets === 0).toBe(true);
    // La clasificación maestra no cambia: el mismo movimiento en un EEFF de 2025 sigue siendo corriente.
    const in2025 = run({ mappings: grouped, start: "2025-01-01", end: "2025-12-31", movements: [payable("2025-11-10", 1_000)] });
    expect([in2025.esf.currentLiabilities, in2025.esf.nonCurrentLiabilities]).toEqual([100_000, 0]);
    expect(in2025.reclassifications).toHaveLength(0);
  });

  it("pasivo originado en el mismo año de los EEFF conserva la clasificación corriente", () => {
    const s = run({ mappings: grouped, movements: [payable("2026-02-10", 1_000)] });
    expect([s.esf.currentLiabilities, s.esf.nonCurrentLiabilities]).toEqual([100_000, 0]);
    expect(s.reclassifications).toHaveLength(0);
  });

  it("activo / deudor originado en 2025 se presenta en «Deudores» no corriente", () => {
    const s = run({ mappings: grouped, movements: [mv("2025-12-15", "130505", 2_000), mv("2026-01-15", "130505", 500)] });
    expect([s.esf.currentAssets, s.esf.nonCurrentAssets]).toEqual([50_000, 200_000]);
    expect(s.sections.asset_noncurrent.lines.find((l) => l.cents !== 0)!.line.name).toBe("Deudores");
    expect(s.reclassifications.map((r) => [r.lineName, r.targetLineName, r.pendingCents])).toEqual([["Deudores", "Deudores", 200_000]]);
  });

  it("aplica a cualquier línea corriente (proveedores, laborales…), sin una lista fija de PUC", () => {
    const withLines = catalog.lines.concat(
      { id: 40, section: "liability_noncurrent", name: "Proveedores", sortOrder: 40, role: null, isActive: true, hasHistory: false },
      { id: 41, section: "liability_noncurrent", name: "Obligaciones laborales", sortOrder: 41, role: null, isActive: true, hasHistory: false },
    );
    const s = run({ catalog: { ...catalog, lines: withLines }, mappings: grouped, movements: [mv("2025-06-01", "220505", 3_000), mv("2025-12-31", "251010", 4_000), mv("2026-01-05", "251010", 1_000)] });
    expect([s.esf.currentLiabilities, s.esf.nonCurrentLiabilities]).toEqual([100_000, 700_000]);
    expect(s.sections.liability_noncurrent.lines.filter((l) => l.cents !== 0).map((l) => [l.line.name, l.cents])).toEqual([["Proveedores", 300_000], ["Obligaciones laborales", 400_000]]);
  });

  it("saldo parcialmente pagado: conserva el origen y solo reclasifica lo pendiente", () => {
    const s = run({
      mappings: grouped,
      movements: [payable("2025-11-10", 1_000, { documentNumber: "F-1" }), payable("2026-02-01", 400, { source: "bank", dc: "D" })],
    });
    expect([s.esf.currentLiabilities, s.esf.nonCurrentLiabilities]).toEqual([0, 60_000]);
    expect(s.reclassifications[0]).toMatchObject({ originalCents: 100_000, appliedCents: 40_000, pendingCents: 60_000, originYear: 2025, document: "F-1" });
  });

  it("el pago se aplica primero al documento al que hace referencia y, si no, al origen más antiguo (PEPS)", () => {
    const origins = [payable("2025-11-10", 1_000, { documentNumber: "F-1" }), payable("2026-01-10", 500, { documentNumber: "F-2" })];
    // Sin referencia: 1.200 consume los 1.000 de 2025 y 200 de 2026.
    const fifo = run({ mappings: grouped, movements: [...origins, payable("2026-03-01", 1_200, { source: "bank", dc: "D" })] });
    expect([fifo.esf.currentLiabilities, fifo.esf.nonCurrentLiabilities]).toEqual([30_000, 0]);
    // Con referencia al documento de 2026: 300 reducen F-2 aunque F-1 sea más antiguo.
    const byDoc = run({ mappings: grouped, movements: [...origins, payable("2026-03-01", 300, { source: "bank", dc: "D", documentNumber: "F-2" })] });
    expect([byDoc.esf.currentLiabilities, byDoc.esf.nonCurrentLiabilities]).toEqual([20_000, 100_000]);
  });

  it("un pago sin saldo de origen no se asume: queda para revisión y no se reclasifica", () => {
    const s = run({ mappings: grouped, movements: [payable("2026-03-01", 700, { source: "bank", dc: "D" })] });
    expect([s.esf.currentLiabilities, s.esf.nonCurrentLiabilities]).toEqual([-70_000, 0]);
    expect(s.reclassifications).toHaveLength(0);
    expect(s.reclassificationReviews).toEqual([expect.objectContaining({ pucCode: "237005", cents: -70_000, date: "2026-03-01" })]);
  });

  it("una línea ya definida como no corriente no se reclasifica ni se duplica", () => {
    const s = run({ mappings: [...grouped, map("237099", 35)], movements: [payable("2025-11-10", 1_000), mv("2025-11-11", "237099", 2_000)] });
    expect(s.esf.nonCurrentLiabilities).toBe(300_000);
    expect(s.reclassifications.map((r) => r.pucCode)).toEqual(["237005"]);
  });

  it("el efectivo (clase 11) es una posición, no un saldo con origen: nunca se reclasifica", () => {
    const s = run({ movements: [mv("2025-12-31", "110505", 5_000, { source: "opening" })] });
    expect([s.esf.currentAssets, s.esf.nonCurrentAssets]).toEqual([500_000, 0]);
    expect(s.reclassifications).toHaveLength(0);
  });

  it("sin la línea no corriente equivalente: bloqueo visible, el valor queda en su línea y se resuelve creándola", () => {
    const without: FsCatalog = { ...catalog, lines: catalog.lines.filter((l) => l.id !== 35) };
    const s = run({ catalog: without, mappings: grouped, movements: [payable("2025-11-10", 1_000)] });
    expect(s.missingCounterparts).toEqual([{ lineId: 6, lineName: "Cuentas por pagar", section: "liability_current", targetSection: "liability_noncurrent", cents: 100_000 }]);
    expect([s.esf.currentLiabilities, s.esf.nonCurrentLiabilities]).toEqual([100_000, 0]);
    expect(s.reclassifications).toHaveLength(0);
    const blocked = checklist(s, s, [], [], 0);
    expect(blocked.find((c) => c.id === "counterparts")).toMatchObject({ ok: false });
    expect(blocked.find((c) => c.id === "blocking")!.ok).toBe(false);
    // Crear la línea con el mismo nombre en la sección no corriente lo resuelve.
    const fixed = run({ catalog, mappings: grouped, movements: [payable("2025-11-10", 1_000)] });
    expect(fixed.missingCounterparts).toHaveLength(0);
    expect(checklist(fixed, fixed, [], [], 0).find((c) => c.id === "counterparts")!.ok).toBe(true);
  });

  it("una línea corriente sin saldos de años anteriores no exige contraparte", () => {
    const without: FsCatalog = { ...catalog, lines: catalog.lines.filter((l) => l.id !== 35) };
    expect(run({ catalog: without, mappings: grouped, movements: [payable("2026-02-10", 1_000)] }).missingCounterparts).toHaveLength(0);
  });
});
