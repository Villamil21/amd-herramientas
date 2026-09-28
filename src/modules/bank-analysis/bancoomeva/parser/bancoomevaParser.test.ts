import { describe, expect, it } from "vitest";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../shared/pdf/pdfTypes";
import { StatementError } from "../../shared/types";
import { analyzeBancoomeva } from "../services/analysis";
import { buildBancoomevaSheets, suggestedBancoomevaName } from "../services/excelExport";
import { BANCOOMEVA_MESSAGES, parseBancoomevaAmount, parseBancoomevaStatement } from "./bancoomevaParser";

// ---------------------------------------------------------------------------
// PDF sintético con la geometría del extracto Bancoomeva real: página A4,
// letra de 7 pt en la tabla (~3,6 pt por carácter), todas las columnas
// centradas bajo su título, filas cada 12 pt y el bloque de totales del
// extracto completo repetido al pie de cada página.
// ---------------------------------------------------------------------------

const CW = 3.6;
/** Fragmento centrado en `center`. */
const c = (text: string, center: number, y: number, height = 7): PdfTextItem => ({ text, x: center - (text.length * CW) / 2, y, width: text.length * CW, height });

const COL = { date: 58.5, office: 133.5, description: 248.5, debit: 361, credit: 446, balance: 528.5 };
const HEADER_COL = { date: 60, office: 130, description: 250, debit: 362.5, credit: 447.5, balance: 530.5 };

const money = (cents: number) => {
  const int = Math.floor(Math.abs(cents) / 100).toLocaleString("en-US");
  return `$ ${cents < 0 ? "-" : ""}${int}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
};

const header = (y: number): PdfTextItem[] => [
  c("FECHA", HEADER_COL.date, y, 8),
  c("OFICINA", HEADER_COL.office, y, 8),
  c("DESCRIPCION", HEADER_COL.description, y, 8),
  c("VALOR DEBITO", HEADER_COL.debit, y, 8),
  c("VALOR CREDITO", HEADER_COL.credit, y, 8),
  c("SALDO", HEADER_COL.balance, y, 8),
];

interface Mov {
  date?: string;
  description: string | string[];
  debit?: number;
  credit?: number;
  balance?: number;
}

/** Filas de la tabla; el saldo se calcula desde `opening` salvo que la fila lo fije. */
function tableRows(movs: Mov[], startY: number, opening = 0): { items: PdfTextItem[]; balance: number; endY: number } {
  const items: PdfTextItem[] = [];
  let y = startY;
  let balance = opening;
  for (const m of movs) {
    const debit = m.debit ?? 0;
    const credit = m.credit ?? 0;
    balance = m.balance ?? balance - debit + credit;
    const lines = Array.isArray(m.description) ? m.description : [m.description];
    items.push(
      c(m.date ?? "04-06-2026", COL.date, y),
      c("LABORATORIO - CORE", COL.office, y),
      c(money(debit), COL.debit, y),
      c(money(credit), COL.credit, y),
      c(money(balance), COL.balance, y),
      ...lines.map((line, i) => c(line, COL.description, y - i * 8)),
    );
    y -= 12 + (lines.length - 1) * 8;
  }
  return { items, balance, endY: y };
}

interface Totals {
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

const totalsBlock = (t: Totals, y: number): PdfTextItem[] => [
  c("SALDO INICIAL", 93, y, 8),
  c("RENDIMIENTOS No", 199, y, 8),
  c("TOTAL DEBITO", 305, y, 8),
  c("TOTAL CREDITO", 411, y, 8),
  c("SALDO FINAL", 517, y, 8),
  c(money(t.opening), 93, y - 16, 8),
  c("$ 0,00", 199, y - 16, 8),
  c(money(t.debit), 305, y - 16, 8),
  c(money(t.credit), 411, y - 16, 8),
  c(money(t.closing), 517, y - 16, 8),
];

const legal = (y: number): PdfTextItem[] => [
  { text: "Si usted tiene una queja o reclamo, por favor comuníquela a las siguientes instancias: www.bancoomeva.com.co – Opción Contáctanos.", x: 44, y, width: 524, height: 6.5 },
  { text: "https://www.defensoriapgabogadosasociados.com/. La Defensoría del Consumidor es una institución independiente.", x: 44, y: y - 8, width: 524, height: 6.5 },
];

const accountBlock = (): PdfTextItem[] => [
  c("Extracto de Cuenta", 305, 769, 11),
  { text: "CUENTA No:", x: 50, y: 712.4, width: 42.7, height: 7 },
  { text: "30520000000275", x: 110, y: 712.4, width: 54.5, height: 7 },
  { text: "DEL:", x: 370, y: 725.2, width: 16.3, height: 7 },
  { text: "01-06-2026", x: 396, y: 725.2, width: 35.8, height: 7 },
  { text: "AL:", x: 440, y: 725.2, width: 10, height: 6 },
  { text: "30-06-2026", x: 459.7, y: 725.2, width: 35.8, height: 7 },
];

const page = (pageNumber: number, items: PdfTextItem[]): PdfPageText => ({ pageNumber, width: 595, height: 842, items });
const docOf = (...pages: PdfPageText[]): PdfDocumentText => ({ pageCount: pages.length, pages });

function totalsOf(movs: Mov[], opening = 0): Totals {
  const debit = movs.reduce((s, m) => s + (m.debit ?? 0), 0);
  const credit = movs.reduce((s, m) => s + (m.credit ?? 0), 0);
  return { opening, debit, credit, closing: opening + credit - debit };
}

/** Extracto con los movimientos repartidos en páginas de `perPage` filas; encabezado y totales en cada página. */
function statement(movs: Mov[], o: { perPage?: number; totals?: Totals; pageTotals?: (page: number, t: Totals) => Totals } = {}): PdfDocumentText {
  const perPage = o.perPage ?? movs.length;
  const totals = o.totals ?? totalsOf(movs);
  const pages: PdfPageText[] = [];
  let balance = totals.opening;
  for (let i = 0, n = 1; i < movs.length; i += perPage, n++) {
    const top = n === 1 ? 629.9 : 784.9;
    const table = tableRows(movs.slice(i, i + perPage), top - 23.2, balance);
    balance = table.balance;
    const t = o.pageTotals ? o.pageTotals(n, totals) : totals;
    pages.push(page(n, [...(n === 1 ? accountBlock() : []), ...header(top), ...table.items, ...totalsBlock(t, table.endY - 30), ...legal(table.endY - 70)]));
  }
  return docOf(...pages);
}

const expectError = (fn: () => unknown, message: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(StatementError);
    expect((e as Error).message).toBe(message);
    return;
  }
  throw new Error("se esperaba un error");
};

const REAL: Mov[] = [
  { date: "04-06-2026", description: "N/CNC TRANSFERENCIA ACH-000009", credit: 2_840_000_000 },
  { date: "12-06-2026", description: "N/DND TRANSACCIONES BRE-B MONO", debit: 888_000_000 },
  { date: "12-06-2026", description: "N/DND TRANSACCIONES BRE-B MONO", debit: 311_263_800 },
  { date: "25-06-2026", description: "N/CNC TRANSACCIONES BRE-B MONO", credit: 1_000_000 },
];

describe("importes Bancoomeva", () => {
  it("interpreta coma de miles y punto decimal", () => {
    expect(parseBancoomevaAmount("$ 28,400,000.00")).toBe(2_840_000_000);
    expect(parseBancoomevaAmount("$ 8,880,000.00")).toBe(888_000_000);
    expect(parseBancoomevaAmount("$ 0.00")).toBe(0);
    expect(parseBancoomevaAmount("$ 1,145,215,428.00")).toBe(114_521_542_800);
    expect(parseBancoomevaAmount("$ -1,500.50")).toBe(-150_050);
    expect(parseBancoomevaAmount("$ 0,00")).toBeNull();
    expect(parseBancoomevaAmount("LABORATORIO - CORE")).toBeNull();
  });
});

describe("parser Bancoomeva", () => {
  it("clasifica por columna: crédito (caso 1 y 5) y débito (caso 2 y 6)", () => {
    const { statement: s, validation } = analyzeBancoomeva(statement(REAL));
    expect(s.movements[0]).toEqual({
      index: 0,
      date: "04-06-2026",
      office: "LABORATORIO - CORE",
      description: "N/CNC TRANSFERENCIA ACH-000009",
      debitCents: 0,
      creditCents: 2_840_000_000,
      transactionType: "credit",
      amountCents: 2_840_000_000,
      balanceCents: 2_840_000_000,
      page: 1,
      y: expect.closeTo(606.7),
    });
    expect(s.movements[1]).toMatchObject({ description: "N/DND TRANSACCIONES BRE-B MONO", transactionType: "debit", amountCents: 888_000_000, debitCents: 888_000_000, creditCents: 0 });
    expect(s.accountNumber).toBe("30520000000275");
    expect([s.periodFrom, s.periodTo]).toEqual(["2026/06/01", "2026/06/30"]);
    expect(s.issues).toEqual([]);
    expect(validation.validated).toBe(true);
  });

  it("no usa el texto para clasificar: un N/CNC en VALOR DEBITO es débito", () => {
    const { statement: s } = analyzeBancoomeva(statement([{ description: "N/CNC TRANSACCIONES BRE-B MONO", debit: 10_000 }]));
    expect(s.movements[0].transactionType).toBe("debit");
  });

  it("separa la misma descripción en crédito y débito sin netear (caso 3)", () => {
    const movs: Mov[] = [
      { description: "CONCEPTO A", debit: 10_000 },
      { description: "CONCEPTO A", credit: 5_000 },
      { description: "CONCEPTO A", credit: 20_000 },
    ];
    const { groups, summary } = analyzeBancoomeva(statement(movs, { totals: { opening: 100_000, debit: 10_000, credit: 25_000, closing: 115_000 } }));
    expect(groups.map((g) => [g.description, g.transactionType, g.count, g.totalCents])).toEqual([
      ["CONCEPTO A", "credit", 2, 25_000],
      ["CONCEPTO A", "debit", 1, 10_000],
    ]);
    expect(summary).toMatchObject({ conceptCount: 1, creditGroups: 1, debitGroups: 1, totalCreditsCents: 25_000, totalDebitsCents: 10_000, netCents: 15_000 });
  });

  it("no agrupa descripciones parecidas (caso 4)", () => {
    const { groups } = analyzeBancoomeva(statement(REAL));
    expect(groups.map((g) => g.description)).toEqual(["N/CNC TRANSACCIONES BRE-B MONO", "N/CNC TRANSFERENCIA ACH-000009", "N/DND TRANSACCIONES BRE-B MONO"]);
  });

  it("procesa todas las páginas, ignora encabezados, totales y textos legales repetidos (casos 7, 8 y 9)", () => {
    const movs: Mov[] = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? { description: "N/CNC TRANSACCIONES BRE-B MONO", credit: 1_200_000_000 } : { description: "N/DND TRANSACCIONES BRE-B MONO", debit: 300_000_000 + i }));
    const { statement: s, validation } = analyzeBancoomeva(statement(movs, { perPage: 7 }));
    expect(s.pageCount).toBe(5);
    expect(s.movementsByPage).toEqual({ 1: 7, 2: 7, 3: 7, 4: 7, 5: 2 });
    expect(s.movements).toHaveLength(30);
    expect(s.movements.every((m) => /^N\/(CNC|DND) TRANSACCIONES BRE-B MONO$/.test(m.description))).toBe(true);
    // Los totales del extracto se toman una sola vez, aunque aparecen en las 5 páginas.
    const t = totalsOf(movs);
    expect(s.totals).toEqual({ openingBalanceCents: 0, totalDebitsCents: t.debit, totalCreditsCents: t.credit, closingBalanceCents: t.closing });
    expect(s.totalsMismatchPages).toEqual([]);
    expect(s.issues).toEqual([]);
    expect(validation.validated).toBe(true);
  });

  it("advierte si el bloque de totales difiere entre páginas", () => {
    const movs = [...REAL, ...REAL];
    const d = statement(movs, { perPage: 4, pageTotals: (n, t) => (n === 2 ? { ...t, debit: t.debit + 100 } : t) });
    const { statement: s, validation } = analyzeBancoomeva(d);
    expect(s.totals.totalDebitsCents).toBe(totalsOf(movs).debit);
    expect(s.totalsMismatchPages).toEqual([2]);
    expect(validation.checks.find((c) => c.id === "repeated-totals")?.status).toBe("failed");
    expect(validation.validated).toBe(false);
  });

  it("une descripciones de varias líneas sin crear filas nuevas", () => {
    const movs: Mov[] = [{ description: ["N/CNC TRANSFERENCIA", "ACH-000009"], credit: 100_000 }, REAL[1]];
    const { statement: s } = analyzeBancoomeva(statement(movs, { totals: { opening: 900_000_000, debit: 888_000_000, credit: 100_000, closing: 12_100_000 } }));
    expect(s.movements.map((m) => m.description)).toEqual(["N/CNC TRANSFERENCIA ACH-000009", "N/DND TRANSACCIONES BRE-B MONO"]);
    expect(s.joinedLines).toBe(1);
  });

  it("marca como anomalía una fila con débito y crédito, sin sumarla", () => {
    const movs: Mov[] = [REAL[0], { description: "CONCEPTO RARO", debit: 1_000, credit: 2_000 }, REAL[1]];
    const { statement: s, summary, validation } = analyzeBancoomeva(statement(movs));
    expect(s.anomalies).toMatchObject([{ description: "CONCEPTO RARO", debitCents: 1_000, creditCents: 2_000, page: 1 }]);
    expect(s.movements).toHaveLength(2);
    expect(summary.totalCreditsCents).toBe(2_840_000_000);
    // La secuencia de saldos sí incluye la fila anómala.
    expect(validation.checks.find((c) => c.id === "balances")?.status).toBe("ok");
    expect(validation.checks.find((c) => c.id === "anomalies")?.status).toBe("failed");
    expect(validation.validated).toBe(false);
  });

  it("no toma como movimiento una fila con débito y crédito en cero", () => {
    const { statement: s } = analyzeBancoomeva(statement([REAL[0], { description: "SIN VALOR" }]));
    expect(s.movements).toHaveLength(1);
    expect(s.issues).toMatchObject([{ reason: "La fila no tiene valor en débito ni en crédito." }]);
  });

  it("detecta una fila omitida por la secuencia de saldos y los totales", () => {
    const d = statement(REAL);
    // Se quita la segunda fila (débito de 8,880,000.00).
    const p = d.pages[0];
    const y = p.items.find((i) => i.text === "$ 8,880,000.00")!.y;
    const broken = docOf({ ...p, items: p.items.filter((i) => i.y !== y) });
    const { validation } = analyzeBancoomeva(broken);
    expect(validation.checks.filter((c) => c.status === "failed").map((c) => c.id)).toEqual(["debits", "reconciliation", "balances"]);
    expect(validation.validated).toBe(false);
  });

  it("acepta saldos impresos en otro orden entre movimientos idénticos, sin reordenar ni cambiar valores", () => {
    // Como en el extracto real de julio de 2026: débitos idénticos de 100,000 cuyo saldo
    // impreso sale intercambiado (…589 → …389 → …489 → …289).
    const same = { date: "01-07-2026", description: "N/DND TRANSACCIONES BRE-B MONO", debit: 10_000_000 };
    const printed = [3_458_979_800, 3_438_979_800, 3_448_979_800, 3_428_979_800, 3_408_979_800, 3_418_979_800, 3_398_979_800];
    const movs: Mov[] = [
      { ...same, debit: 1_661_477_400, balance: 3_458_979_800 },
      ...printed.slice(1).map((balance) => ({ ...same, balance })),
      { date: "03-07-2026", description: "N/CNC TRANSACCIONES BRE-B MONO", credit: 1_000_000 },
    ];
    const d = statement(movs, { perPage: 4, totals: totalsOf(movs, 5_120_457_200) });
    const { statement: s, validation } = analyzeBancoomeva(d);
    // Orden visual y valores tal como están en el PDF.
    expect(s.movements.map((m) => m.balanceCents)).toEqual([...printed, 3_399_979_800]);
    expect(s.movements.map((m) => m.page)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    const balances = validation.checks.find((c) => c.id === "balances")!;
    expect(balances.status).toBe("ok");
    expect(balances.detail).toMatch(/En 2 tramo\(s\) de movimientos idénticos .*4 filas, página\(s\) 1, 2/);
    expect(validation.checks.find((c) => c.id === "order")?.status).toBe("ok");
    expect(validation.validated).toBe(true);
  });

  it("no acepta como orden distinto un saldo que no corresponde a ninguna fila", () => {
    const same = { date: "01-07-2026", description: "N/DND TRANSACCIONES BRE-B MONO", debit: 10_000_000 };
    // El segundo y tercer saldo repiten el mismo valor: falta uno de los saldos esperados.
    const movs: Mov[] = [
      { ...same, balance: 90_000_000 },
      { ...same, balance: 70_000_000 },
      { ...same, balance: 70_000_000 },
    ];
    const { validation } = analyzeBancoomeva(statement(movs, { totals: { opening: 100_000_000, debit: 30_000_000, credit: 0, closing: 70_000_000 } }));
    expect(validation.checks.find((c) => c.id === "balances")).toMatchObject({ status: "failed", detail: expect.stringMatching(/^Se detectaron 2 inconsistencia/) });
    expect(validation.validated).toBe(false);
  });

  it("no acepta saldos intercambiados entre movimientos distintos", () => {
    const movs: Mov[] = [
      { description: "N/DND A", debit: 10_000_000, balance: 80_000_000 },
      { description: "N/DND B", debit: 20_000_000, balance: 90_000_000 },
    ];
    const { validation } = analyzeBancoomeva(statement(movs, { totals: { opening: 100_000_000, debit: 30_000_000, credit: 0, closing: 70_000_000 } }));
    expect(validation.checks.find((c) => c.id === "balances")?.status).toBe("failed");
  });

  it("detecta una página leída dos veces, aunque sus filas sean idénticas", () => {
    const d = statement(REAL);
    const { validation } = analyzeBancoomeva(docOf(d.pages[0], d.pages[0]));
    expect(validation.checks.find((c) => c.id === "order")?.status).toBe("failed");
    expect(validation.validated).toBe(false);
  });

  it("rechaza un PDF que no es de Bancoomeva", () => {
    const other = docOf(page(1, [c("EXTRACTO DE CUENTA DE AHORROS", 300, 700, 10), c("SALDO ANTERIOR", 100, 680, 8)]));
    expectError(() => parseBancoomevaStatement(other), BANCOOMEVA_MESSAGES.format);
  });

  it("informa si no hay movimientos", () => {
    const d = docOf(page(1, [...accountBlock(), ...header(629.9), ...totalsBlock({ opening: 0, debit: 0, credit: 0, closing: 0 }, 580), ...legal(540)]));
    expectError(() => parseBancoomevaStatement(d), BANCOOMEVA_MESSAGES.noMovements);
  });
});

describe("exportación Bancoomeva", () => {
  it("arma las hojas Resumen y Movimientos (caso 11)", () => {
    const { statement: s, groups } = analyzeBancoomeva(statement(REAL));
    const [resumen, movimientos] = buildBancoomevaSheets(s, groups);
    expect(resumen.columns.map((col) => col.header)).toEqual(["Descripción", "Tipo", "Cantidad", "Total"]);
    expect(resumen.rows).toEqual([
      ["N/CNC TRANSACCIONES BRE-B MONO", "Crédito", 1, 10_000],
      ["N/CNC TRANSFERENCIA ACH-000009", "Crédito", 1, 28_400_000],
      ["N/DND TRANSACCIONES BRE-B MONO", "Débito", 2, 11_992_638],
    ]);
    expect(movimientos.columns.map((col) => col.header)).toEqual(["Fecha", "Oficina", "Descripción", "Valor Débito", "Valor Crédito", "Tipo", "Valor", "Saldo", "Página"]);
    expect(movimientos.rows[1]).toEqual(["12-06-2026", "LABORATORIO - CORE", "N/DND TRANSACCIONES BRE-B MONO", 8_880_000, 0, "Débito", 8_880_000, 19_520_000, 1]);
    expect(suggestedBancoomevaName(s, "Junio.pdf")).toBe("Analisis_Bancoomeva_0275_2026-06");
  });
});
