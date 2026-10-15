import { describe, expect, it } from "vitest";
import type { BankBalance, FsCatalog, FsLine, FsPucMapping, FsSectionKey, Movement } from "../../../types/fs";
import { formatStatementPesos, roundThousands, estimatedIncomeTax } from "../shared/money";
import { buildStatements, eerrRows, esfRows, isBalanced, type EngineInput } from "./engine";

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

const map = (pucCode: string, lineId: number | null, excluded = false): FsPucMapping => ({ pucCode, lineId, excluded, updatedAt: "" });

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
  it("saldo bancario: la foto más reciente ≤ fecha final, nunca la suma de meses", () => {
    const bankBalances = [balance("2026-08-31", 265_740_263, 1), balance("2026-09-30", 310_000_000, 2)];
    const aug = run({ bankBalances, end: "2026-08-31" });
    const sep = run({ bankBalances, end: "2026-09-30" });
    expect(aug.sections.asset_current.totalCents).toBe(26_574_026_300);
    expect(sep.sections.asset_current.totalCents).toBe(31_000_000_000);
    // Un lote reemplazado ya no cuenta.
    expect(run({ bankBalances: [balance("2026-08-31", 1, 1), { ...balance("2026-08-31", 9, 2), active: false }] }).esf.currentAssets).toBe(100);
  });

  it("capital social desde Empresas y la diferencia suscrito − pagado en 132505", () => {
    const s = run({ company: { subscribedTotalShares: 2_000, subscribedNominalValue: 1_000, paidTotalShares: 1_500, paidNominalValue: 1_000 } });
    const equity = s.sections.equity.lines.find((l) => l.line.role === "share_capital")!;
    expect(equity.cents).toBe(200_000_000);
    expect(s.pucBalances.get("132505")).toBe(50_000_000);
    expect(isBalanced(s)).toBe(false);
    // Suscrito = pagado: sin saldo en 132505.
    expect(run({ company: { subscribedTotalShares: 2_000, subscribedNominalValue: 1_000, paidTotalShares: 2_000, paidNominalValue: 1_000 } }).pucBalances.has("132505")).toBe(false);
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
    expect(s.unclassified.map((u) => [u.pucCode, u.cents])).toEqual([["519595", 100_000]]);
    expect(s.eerr.admin + s.eerr.sales + s.esf.assets).toBe(0);
  });

  it("una línea desactivada no se pierde: su PUC vuelve a pendiente", () => {
    const off: FsCatalog = { ...catalog, lines: catalog.lines.map((l) => (l.id === 26 ? { ...l, isActive: false } : l)) };
    const s = run({ catalog: off, movements: [mv("2026-03-01", "513595", 1_000)] });
    expect(s.unclassified[0]).toMatchObject({ pucCode: "513595", inactiveLine: "Servicios" });
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
