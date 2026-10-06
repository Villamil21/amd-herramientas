import { describe, expect, it } from "vitest";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../shared/pdf/pdfTypes";
import { StatementError } from "../../shared/types";
import { analyzeBbva } from "../services/analysis";
import { buildBbvaSheets, suggestedBbvaName } from "../services/excelExport";
import { BBVA_MESSAGES, parseBbvaStatement } from "./bbvaParser";

// ---------------------------------------------------------------------------
// PDF sintético con la geometría del extracto BBVA real: página carta, letra
// de 6 pt (~3,3 pt por carácter), filas cada 7,2 pt, valores alineados a la
// derecha y SIN títulos de columna (en el PDF real son parte del dibujo).
// La primera página empieza la tabla más abajo y con las columnas de texto
// unos puntos a la izquierda, igual que el extracto.
// ---------------------------------------------------------------------------

const CW = 3.3;
const left = (text: string, x: number, y: number, height = 6): PdfTextItem => ({ text, x, y, width: text.length * CW, height });
const right = (text: string, edge: number, y: number): PdfTextItem => ({ text, x: edge - text.length * CW, y, width: text.length * CW, height: 6 });

const EDGE = { charge: 435, credit: 506, balance: 575 };

const money = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100).toLocaleString("en-US")}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

interface Mov {
  number?: string | null;
  operation?: string;
  value?: string;
  concept: string;
  charge?: number;
  credit?: number;
  /** Saldo impreso; por defecto, el que resulta de aplicar el movimiento. */
  balance?: number | null;
}

interface Totals {
  opening: number;
  credits: [number | undefined, number];
  interest: [number | undefined, number];
  charges: [number | undefined, number];
  vat: [number | undefined, number];
  fourPerThousand: [number | undefined, number];
  withholdings: [number | undefined, number];
  closing: number;
}

function summaryBlock(t: Totals): PdfTextItem[] {
  const line = (label: string, labelX: number, countX: number, edge: number, y: number, [count, cents]: [number | undefined, number]) => [
    left(label, labelX, y),
    ...(count === undefined ? [] : [left(String(count), countX, y)]),
    right(money(cents), edge, y),
  ];
  return [
    left("SALDO CIERRE MES ANTERIOR", 37.8, 514.1),
    right(money(t.opening), 334.8, 514.1),
    ...line("- IVA", 353.9, 449.7, 563.3, 514.1, t.vat),
    ...line("+ ABONOS", 37.8, 235.4, 334.8, 506.3, t.credits),
    ...line("- 4 POR MIL", 353.9, 447, 563.3, 506.3, t.fourPerThousand),
    ...line("+ INTERESES RECIBIDOS", 37.8, 238.1, 333.6, 498.9, t.interest),
    ...line("- RETENCIONES", 353.9, 449.7, 562.7, 498.9, t.withholdings),
    ...line("- CARGOS", 37.8, 235.4, 334.8, 491.1, t.charges),
    left("SALDO FINAL", 353.9, 491.1),
    right(money(t.closing), 564.9, 491.1),
  ];
}

/** Filas de la tabla desde `startY`; `shift` mueve las columnas de texto (páginas 2 en adelante). */
function tableRows(movs: Mov[], startY: number, opening: number, startNumber: number, shift = 0): { items: PdfTextItem[]; balance: number; nextNumber: number } {
  const items: PdfTextItem[] = [];
  let balance = opening;
  let number = startNumber;
  movs.forEach((m, i) => {
    const y = startY - i * 7.2;
    balance = m.balance ?? balance - (m.charge ?? 0) + (m.credit ?? 0);
    if (m.number !== null) items.push(left(m.number ?? String(number++), 39.6, y));
    items.push(left(m.operation ?? "04-08-2026", 78.6 + shift, y), left(m.value ?? "04-08-2026", 133.6 + shift, y), left(m.concept, 175 + shift, y));
    if (m.charge !== undefined) items.push(right(money(m.charge), EDGE.charge + (shift ? 4 : 0), y));
    if (m.credit !== undefined) items.push(right(money(m.credit), EDGE.credit, y));
    if (m.balance !== null) items.push(right(money(balance), EDGE.balance, y));
  });
  return { items, balance, nextNumber: number };
}

const page = (pageNumber: number, items: PdfTextItem[]): PdfPageText => ({ pageNumber, width: 612, height: 792, items });

interface Options {
  opening?: number;
  totals?: Partial<Totals>;
  extra?: Record<number, PdfTextItem[]>;
}

/** Extracto de una o varias páginas. Los totales del resumen se calculan con los movimientos salvo que se fijen. */
function statement(pages: Mov[][], { opening = 10_000_000, totals = {}, extra = {} }: Options = {}): PdfDocumentText {
  const all = pages.flat();
  const sum = (key: "charge" | "credit") => all.reduce((n, m) => n + (m[key] ?? 0), 0);
  const count = (key: "charge" | "credit") => all.filter((m) => m[key] !== undefined).length;
  const t: Totals = {
    opening,
    credits: [count("credit") || undefined, sum("credit")],
    interest: [undefined, 0],
    charges: [count("charge") || undefined, sum("charge")],
    vat: [undefined, 0],
    fourPerThousand: [undefined, 0],
    withholdings: [undefined, 0],
    closing: opening + sum("credit") - sum("charge"),
    ...totals,
  };
  let balance = opening;
  let number = 985;
  return {
    pageCount: pages.length,
    pages: pages.map((movs, i) => {
      const n = i + 1;
      const rows = tableRows(movs, n === 1 ? 431.4 : 607.4, balance, number, n === 1 ? 0 : 5);
      balance = rows.balance;
      number = rows.nextNumber;
      const head =
        n === 1
          ? [
              left("KAES S.A.S .", 42, 747.1),
              left(".", 42, 738.4),
              left("CLL 20 # 154-34 .", 42, 730),
              left("207286", 59.5, 690.5),
              left("48326", 86.2, 690.5),
              left("CUENTA DE AHORROS EMPRESARIAL", 363.7, 690.5),
              left("JAMUNDI", 37.2, 600.2, 7),
              left("001308610200007491", 455.4, 600.2, 7),
              left("31-08-2026", 455.4, 583.1, 7),
              left("0.00", 455.4, 566.3, 7),
              left("PERÍODO DESDE: 01-08-2026 HASTA: 31-08-2026", 37.2, 552.2, 7),
              left("269,729,593.35", 455.4, 548.9, 7),
              ...summaryBlock(t),
            ]
          : [
              left("KAES S.A.S .", 53, 744.4),
              left("CUENTA DE AHORROS EMPRESARIAL", 369.6, 693.1, 9),
              left("NÚMERO DE CUENTA: 001308610200007491", 46.7, 665.3, 7),
              left("NOMBRE DEL CLIENTE:", 308.9, 665.3, 7),
              left("KAES S.A.S .", 394.5, 665.3, 7),
            ];
      return page(n, [...head, ...rows.items, ...(extra[n] ?? []), left(`Página ${n} de ${pages.length}`, 513.4, 19.1)]);
    }),
  };
}

const PSE: Mov = { concept: "PAGO POR PSE A Davivienda", charge: 985_534_500 };
const TAX: Mov = { concept: "CARGO POR IMPUESTO 4X1.000", charge: 3_942_100 };
const SPARK: Mov = { concept: "ABONO DOMI. 901183029 EMPRESAS SPARK", credit: 255_000_004 };

describe("parser BBVA", () => {
  it("lee cuenta, cliente, periodo, fecha de corte y resumen", () => {
    const s = parseBbvaStatement(statement([[SPARK, PSE, TAX]], { opening: 15_607_063_575, totals: { interest: [1, 0], vat: [5, 0] } }));
    expect(s).toMatchObject({ bank: "BBVA", accountNumber: "001308610200007491", clientName: "KAES S.A.S", periodFrom: "2026/08/01", periodTo: "2026/08/31", cutoffDate: "2026/08/31", pageCount: 1 });
    expect(s.totals).toEqual({
      openingBalanceCents: 15_607_063_575,
      credits: { count: 1, cents: 255_000_004 },
      interest: { count: 1, cents: 0 },
      charges: { count: 2, cents: 989_476_600 },
      vat: { count: 5, cents: 0 },
      fourPerThousand: { count: undefined, cents: 0 },
      withholdings: { count: undefined, cents: 0 },
      closingBalanceCents: 15_607_063_575 + 255_000_004 - 989_476_600,
    });
  });

  it("la columna decide el tipo: Cargos es egreso y Abonos es ingreso", () => {
    const s = parseBbvaStatement(statement([[SPARK, PSE, TAX]]));
    expect(s.issues).toEqual([]);
    expect(s.movements.map((m) => [m.movementNumber, m.concept, m.transactionType, m.chargeCents, m.creditCents, m.amountCents])).toEqual([
      ["985", "ABONO DOMI. 901183029 EMPRESAS SPARK", "credit", 0, 255_000_004, 255_000_004],
      ["986", "PAGO POR PSE A Davivienda", "debit", 985_534_500, 0, 985_534_500],
      ["987", "CARGO POR IMPUESTO 4X1.000", "debit", 3_942_100, 0, 3_942_100],
    ]);
    expect(s.movements[0]).toMatchObject({ operationDate: "04-08-2026", valueDate: "04-08-2026", balanceCents: 265_000_004, page: 1, row: 1 });
    // Un concepto que dice «CARGO» en la columna Abonos sigue siendo un abono.
    const odd = parseBbvaStatement(statement([[{ concept: "CARGO DOMI. 901748281", credit: 5_000 }]]));
    expect(odd.movements[0]).toMatchObject({ transactionType: "credit", creditCents: 5_000 });
  });

  it("recorre todas las páginas, sin encabezados ni resumen como movimientos y sin perder filas al cambiar de página", () => {
    const s = parseBbvaStatement(
      statement([
        [TAX, PSE, SPARK],
        [PSE, TAX, { ...SPARK, operation: "29-08-2026", value: "31-08-2026" }],
        [PSE, { number: null, concept: "ABONO POR INTERESES DE CUENTA", credit: 11_214_000 }, { number: null, concept: "CARGO RETEFUENTE INTERESES", charge: 785_000 }],
      ]),
    );
    expect(s.issues).toEqual([]);
    expect(s.movementsByPage).toEqual({ 1: 3, 2: 3, 3: 3 });
    expect(s.movements.map((m) => m.movementNumber)).toEqual(["985", "986", "987", "988", "989", "990", "991", undefined, undefined]);
    expect(s.movements[3]).toMatchObject({ page: 2, row: 1 });
    expect(s.movements[5]).toMatchObject({ operationDate: "29-08-2026", valueDate: "31-08-2026" });
    expect(s.movements.slice(-2).map((m) => m.transactionType)).toEqual(["credit", "debit"]);
    const { validation } = analyzeBbva(statement([[TAX, PSE, SPARK], [PSE, TAX], [SPARK]]));
    expect(validation.validated).toBe(true);
  });

  it("un abono en 0.00 (APERTURA DE CUENTA) es un movimiento de la columna Abonos", () => {
    const { statement: s, validation } = analyzeBbva(statement([[{ concept: "APERTURA DE CUENTA", credit: 0 }, { concept: "DEPOSITO EN EFECTIVO", credit: 100_000_000 }]], { opening: 0 }));
    expect(s.movements[0]).toMatchObject({ transactionType: "credit", amountCents: 0, balanceCents: 0 });
    expect(validation.validated).toBe(true);
  });

  it("una fila con valor en Cargos y en Abonos queda para revisión, sin elegir una columna", () => {
    const { statement: s, summary, validation } = analyzeBbva(statement([[SPARK, { concept: "AJUSTE", charge: 1_000, credit: 2_000 }, TAX]]));
    expect(s.anomalies).toHaveLength(1);
    expect(s.anomalies[0]).toMatchObject({ concept: "AJUSTE", chargeCents: 1_000, creditCents: 2_000, row: 2 });
    expect(s.movements).toHaveLength(2);
    expect(summary.totalCreditsCents).toBe(255_000_004);
    expect(validation.validated).toBe(false);
    expect(validation.checks.find((c) => c.id === "anomalies")?.status).toBe("failed");
  });

  it("una fila sin valor en Cargos ni en Abonos no se suma y se informa", () => {
    const { statement: s, validation } = analyzeBbva(statement([[SPARK, { concept: "NOTA SIN VALOR" }, TAX]]));
    expect(s.movements.map((m) => m.concept)).toEqual([SPARK.concept, TAX.concept]);
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0]).toMatchObject({ page: 1, reason: "La fila no tiene valor en Cargos ni en Abonos; no se sumó." });
    expect(validation.validated).toBe(false);
  });

  it("no convierte en movimiento un texto o un valor suelto dentro de la tabla", () => {
    const extra = { 1: [left("CONTINUACION DE UN CONCEPTO", 175, 431.4 - 3 * 7.2), right("5,000.00", EDGE.charge, 431.4 - 4 * 7.2)] };
    const { statement: s, validation } = analyzeBbva(statement([[SPARK, PSE, TAX]], { extra }));
    expect(s.movements).toHaveLength(3);
    expect(s.issues.map((i) => i.text)).toEqual(["CONTINUACION DE UN CONCEPTO", "5,000.00"]);
    expect(validation.validated).toBe(false);
  });

  it("no acepta guiones ni textos como valores", () => {
    const y = 431.4;
    const doc = statement([[SPARK]], { extra: { 1: [left("999", 39.6, y - 7.2), left("04-08-2026", 78.6, y - 7.2), left("04-08-2026", 133.6, y - 7.2), left("PAGO", 175, y - 7.2), right("-", EDGE.charge, y - 7.2), right("1,000.00", EDGE.balance, y - 7.2)] } });
    const s = parseBbvaStatement(doc);
    expect(s.movements).toHaveLength(1);
    expect(s.issues[0].reason).toBe('Valor no interpretable en Cargos: "-".');
  });

  it("un valor corrido entre dos columnas no se asigna a ninguna", () => {
    const y = 431.4 - 7.2;
    const row = [left("999", 39.6, y), left("04-08-2026", 78.6, y), left("04-08-2026", 133.6, y), left("PAGO", 175, y), right("1,000,000.00", 470, y), right("1,000.00", EDGE.balance, y)];
    const s = parseBbvaStatement(statement([[SPARK]], { extra: { 1: row } }));
    expect(s.movements).toHaveLength(1);
    expect(s.issues[0].reason).toMatch(/ocupa más de una columna/);
  });

  it("rechaza un PDF que no es un extracto BBVA y uno sin movimientos", () => {
    const other: PdfDocumentText = { pageCount: 1, pages: [page(1, [left("SALDO INICIAL", 40, 700), left("TOTAL DEBITO", 200, 700)])] };
    expect(() => parseBbvaStatement(other)).toThrow(new StatementError(BBVA_MESSAGES.format));
    expect(() => parseBbvaStatement(statement([[]]))).toThrow(new StatementError(BBVA_MESSAGES.noMovements));
  });
});

describe("agrupación BBVA", () => {
  it("agrupa por concepto exacto y nunca mezcla cargos con abonos", () => {
    const { groups, summary } = analyzeBbva(
      statement([
        [PSE, TAX, PSE, TAX, { concept: "PAGO POR PSE A Banco de Bogota", charge: 100 }, SPARK, { concept: "ABONO DOMI. 901748281", credit: 700 }, { concept: "CARGO DOMI. 901748281", charge: 300 }],
        [{ concept: "AJUSTE", charge: 50 }, { concept: "AJUSTE", credit: 80 }, { concept: "AJUSTE", credit: 20 }],
      ]),
    );
    expect(groups.map((g) => [g.concept, g.transactionType, g.count, g.totalCents])).toEqual([
      ["ABONO DOMI. 901183029 EMPRESAS SPARK", "credit", 1, 255_000_004],
      ["ABONO DOMI. 901748281", "credit", 1, 700],
      ["AJUSTE", "credit", 2, 100],
      ["AJUSTE", "debit", 1, 50],
      ["CARGO DOMI. 901748281", "debit", 1, 300],
      ["CARGO POR IMPUESTO 4X1.000", "debit", 2, 7_884_200],
      ["PAGO POR PSE A Banco de Bogota", "debit", 1, 100],
      ["PAGO POR PSE A Davivienda", "debit", 2, 1_971_069_000],
    ]);
    expect(summary).toEqual({ movementCount: 11, conceptCount: 7, creditGroups: 3, chargeGroups: 5, totalCreditsCents: 255_000_804, totalChargesCents: 1_978_953_650, netCents: 255_000_804 - 1_978_953_650 });
  });
});

describe("validación BBVA", () => {
  const check = (doc: PdfDocumentText, id: string) => analyzeBbva(doc).validation.checks.find((c) => c.id === id)!;

  it("valida cuando neto, cantidades, resumen y secuencia de saldos coinciden", () => {
    const { validation } = analyzeBbva(statement([[SPARK, PSE, TAX]]));
    expect(validation.checks.map((c) => [c.id, c.status])).toEqual([
      ["grouping", "ok"],
      ["net", "ok"],
      ["counts", "ok"],
      ["reconciliation", "ok"],
      ["summary", "ok"],
      ["order", "ok"],
      ["balances", "ok"],
    ]);
    expect(validation.validated).toBe(true);
  });

  it("acepta el resumen neto de una devolución que la tabla trae como abono", () => {
    // El banco devuelve 99,200 de 4x1000: fila en Abonos, pero el resumen la descuenta de «4 POR MIL».
    const movs: Mov[] = [SPARK, PSE, { concept: "IMPUESTO DECRETO", charge: 3_942_100 }, { concept: "CORRECCION IMPTO DECRETO", credit: 9_920_000 }];
    const doc = statement([movs], { totals: { credits: [1, 255_000_004], charges: [1, 985_534_500], fourPerThousand: [2, 3_942_100 - 9_920_000] } });
    const { validation, summary } = analyzeBbva(doc);
    expect(summary.totalCreditsCents).toBe(255_000_004 + 9_920_000);
    expect(validation.validated).toBe(true);
    expect(validation.checks.find((c) => c.id === "net")).toMatchObject({ status: "ok" });
    expect(validation.checks.find((c) => c.id === "net")?.detail).toMatch(/\$ 99\.200,00 más en Abonos y en Cargos/);
  });

  it("informa página, fila, concepto, valor, saldo esperado y saldo encontrado cuando la secuencia no cuadra", () => {
    const doc = statement([[SPARK], [PSE, { ...TAX, balance: 5_000_000 }]], { totals: { closing: 5_000_000 } });
    const { validation } = analyzeBbva(doc);
    expect(validation.validated).toBe(false);
    const balances = validation.checks.find((c) => c.id === "balances")!;
    expect(balances.status).toBe("failed");
    expect(balances.detail).toContain("Página 2, fila 2 (movimiento 987), 04-08-2026 «CARGO POR IMPUESTO 4X1.000»: valor interpretado cargo $ 39.421,00; saldo esperado -$ 7.244.765,96; saldo encontrado $ 50.000,00; diferencia $ 7.294.765,96.");
  });

  it("no valida si falta una fila (neto, cantidades y saldos lo detectan) ni altera los movimientos", () => {
    // El resumen cuenta 3 movimientos, pero la tabla solo trae 2.
    const doc = statement([[SPARK, PSE]], { totals: { charges: [2, 985_534_500 + 3_942_100], closing: 10_000_000 + 255_000_004 - 985_534_500 - 3_942_100 } });
    const { validation, statement: s } = analyzeBbva(doc);
    expect(s.movements).toHaveLength(2);
    expect(validation.validated).toBe(false);
    for (const id of ["net", "counts", "reconciliation", "balances"]) expect(validation.checks.find((c) => c.id === id)?.status, id).toBe("failed");
    expect(check(doc, "summary").status).toBe("ok");
  });

  it("no valida si una fila no trae saldo", () => {
    const { validation } = analyzeBbva(statement([[SPARK, { ...PSE, balance: null }]]));
    expect(validation.checks.find((c) => c.id === "balances")?.status).toBe("unavailable");
    expect(validation.validated).toBe(false);
  });
});

describe("exportación BBVA", () => {
  it("construye Resumen y Movimientos con Cargo y Abono separados", () => {
    const { statement: s, groups } = analyzeBbva(statement([[SPARK, PSE], [{ number: null, concept: "ABONO POR INTERESES DE CUENTA", credit: 11_214_000 }]]));
    const [resumen, movimientos] = buildBbvaSheets(s, groups);
    expect(resumen.columns.map((c) => c.header)).toEqual(["Concepto", "Tipo", "Cantidad de movimientos", "Total"]);
    expect(resumen.rows).toEqual([
      ["ABONO DOMI. 901183029 EMPRESAS SPARK", "Abono", 1, 2_550_000.04],
      ["ABONO POR INTERESES DE CUENTA", "Abono", 1, 112_140],
      ["PAGO POR PSE A Davivienda", "Cargo", 1, 9_855_345],
    ]);
    expect(movimientos.columns.map((c) => c.header)).toEqual(["Movimiento", "Fecha operación", "Fecha valor", "Concepto", "Cargo", "Abono", "Saldo", "Página"]);
    expect(movimientos.rows).toEqual([
      ["985", "04-08-2026", "04-08-2026", "ABONO DOMI. 901183029 EMPRESAS SPARK", null, 2_550_000.04, 2_650_000.04, 1],
      ["986", "04-08-2026", "04-08-2026", "PAGO POR PSE A Davivienda", 9_855_345, null, -7_205_344.96, 1],
      [null, "04-08-2026", "04-08-2026", "ABONO POR INTERESES DE CUENTA", null, 112_140, -7_093_204.96, 2],
    ]);
    expect(suggestedBbvaName(s, "Extracto BBVA Agosto.pdf")).toBe("Analisis_BBVA_7491_2026-08");
    expect(suggestedBbvaName({ ...s, accountNumber: undefined }, "Extracto BBVA Agosto.pdf")).toBe("Analisis_Extracto BBVA Agosto");
  });
});
