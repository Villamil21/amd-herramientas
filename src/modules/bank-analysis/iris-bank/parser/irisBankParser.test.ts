import { describe, expect, it } from "vitest";
import { groupMovements } from "../../shared/groupingService";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../shared/pdf/pdfTypes";
import { summarize } from "../../shared/summaryService";
import { StatementError, type BankMovement } from "../../shared/types";
import { analyzeIrisBank } from "../services/analysis";
import { buildIrisBankSheets } from "../services/excelExport";
import { validateIrisBank } from "../services/validation";
import { IRIS_BANK_MESSAGES, parseIrisBankAmount, parseIrisBankStatement } from "./irisBankParser";

// ---------------------------------------------------------------------------
// PDF sintético con la geometría del extracto Iris Bank real: letra de 8 pt
// (~4,6 pt por carácter), Día/Referencia/Descripción alineados a la
// izquierda, Movimientos y Saldo alineados a la derecha bajo su título, filas
// cada 16,6 pt y descripciones multilínea centradas en la fila.
// ---------------------------------------------------------------------------

const CW = 4.6;
const text = (t: string, x: number, y: number, height = 8): PdfTextItem => ({ text: t, x, y, width: t.length * CW, height });
const right = (t: string, r: number, y: number) => text(t, r - t.length * CW, y);

const X = { day: 36.5, ref: 100.1, desc: 179.9, movRight: 455.7, balRight: 553.9 };
const HEADER_Y = 602.5;
const header = (y = HEADER_Y): PdfTextItem[] => [
  { text: "DÍA", x: 36.5, y, width: 13.5, height: 8 },
  { text: "REFERENCIA", x: 100.1, y, width: 50.6, height: 8 },
  { text: "DESCRIPCIÓN", x: 179.5, y, width: 55.6, height: 8 },
  { text: "MOVIMIENTOS", x: 397.6, y, width: 58.1, height: 8 },
  { text: "SALDO", x: 526.3, y, width: 27.6, height: 8 },
];

const money = (cents: number) => {
  const abs = Math.abs(cents);
  const int = Math.floor(abs / 100).toLocaleString("en-US");
  return `$ ${cents < 0 ? "-" : ""}${int}.${String(abs % 100).padStart(2, "0")}`;
};

interface Row {
  day: string;
  ref: string;
  /** Una línea, o varias si la descripción es multilínea. */
  desc: string | string[];
  cents: number;
  balance?: number;
}

function tableItems(rows: Row[], startY = HEADER_Y - 21, pitch = 16.6): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  let y = startY;
  for (const r of rows) {
    const lines = Array.isArray(r.desc) ? r.desc : [r.desc];
    // Celdas multilínea: las líneas quedan centradas verticalmente en la fila.
    const extra = (lines.length - 1) * 9.7;
    y -= extra / 2;
    items.push(text(r.day, X.day, y), text(r.ref, X.ref, y), right(money(r.cents), X.movRight, y));
    if (r.balance !== undefined) items.push(right(money(r.balance), X.balRight, y));
    lines.forEach((line, i) => items.push(text(line, X.desc, y + extra / 2 - i * 9.7)));
    y -= pitch + extra / 2;
  }
  return items;
}

/** Filas con saldo encadenado a partir de un saldo inicial. */
function chained(rows: Omit<Row, "balance">[], opening: number): Row[] {
  let balance = opening;
  return rows.map((r) => ({ ...r, balance: (balance += r.cents) }));
}

function summaryItems(t: { prev: number; credits: number; debits: number; current: number }): PdfTextItem[] {
  return [
    text("Estado Cuenta Empresarial", 92, 671.1, 16),
    text("01/01/2026 al 31/01/2026", 40, 638, 10),
    text("Cuenta N°: 100656570983", 229.5, 638, 10),
    text("Saldo Mes Anterior", 45.3, 530.7),
    text(money(t.prev), 212.5, 530.7),
    text("Total IVA", 310.3, 530.7),
    text("$ 0.00", 518.8, 530.7),
    text("Total Abonos", 45.3, 510.3),
    text(money(t.credits), 201.3, 510.3),
    text("Total Cargos", 45.3, 490.8),
    text(money(t.debits), 201.3, 490.8),
    text("Saldo Actual", 45.3, 472),
    text(money(t.current), 223.7, 472),
    text("Saldo IrisCard", 45.3, 432.7),
    text("$ 0.00", 247.9, 432.7),
  ];
}

/** Bloque de tasas (desde la página 2, como en el extracto real) y pie «página N de M». */
const footer = (n: number, total: number) => [
  ...(n > 1
    ? [text("PLAN ACTUAL", 40.4, 308.9), text("TASA E.A.", 233, 308.9), text("De $80,000,000.00 a $", 40.4, 290.1), text("5%", 258.8, 290.1)]
    : []),
  text(`página ${n} de ${total}`, 256.7, n > 1 ? 63.2 : 87.6, 9),
];

function statement(pagesRows: Row[][], opening = 100_000_00, withSummary = true): PdfDocumentText {
  const all = pagesRows.flat();
  const credits = all.filter((r) => r.cents > 0).reduce((s, r) => s + r.cents, 0);
  const debits = -all.filter((r) => r.cents < 0).reduce((s, r) => s + r.cents, 0);
  const pages: PdfPageText[] = pagesRows.map((rows, i) => {
    const first = i === 0;
    const headerY = first ? 388 : HEADER_Y;
    return {
      pageNumber: i + 1,
      width: 593,
      height: 839,
      items: [
        ...(first && withSummary ? summaryItems({ prev: opening, credits, debits, current: opening + credits - debits }) : [text("Estado Cuenta Empresarial", 92, 671.1, 16)]),
        ...header(headerY),
        ...tableItems(rows, headerY - 21),
        ...footer(i + 1, pagesRows.length),
      ],
    };
  });
  return { pageCount: pages.length, pages };
}

const m = (description: string, valueCents: number): BankMovement => ({
  index: 0,
  date: "01/01/26",
  description,
  valueCents,
  page: 1,
  sign: valueCents > 0 ? "positive" : valueCents < 0 ? "negative" : "zero",
});

let refSeq = 3_839_121;
const r = (desc: string | string[], cents: number, day = "01/01/26"): Omit<Row, "balance"> => ({ day, ref: String(refSeq++), desc, cents });

// ---------------------------------------------------------------------------

describe("parseIrisBankAmount", () => {
  it("interpreta coma de miles, punto decimal y signo delante (caso 5)", () => {
    expect(parseIrisBankAmount("$ -2,223,606.00")).toBe(-222_360_600);
    expect(parseIrisBankAmount("$ 409,488,572.00")).toBe(40_948_857_200);
    expect(parseIrisBankAmount("$ -100,000,000.00")).toBe(-10_000_000_000);
    expect(parseIrisBankAmount("$ 5,794,178,534.51")).toBe(579_417_853_451);
    expect(parseIrisBankAmount("-$ 1,000.05")).toBe(-100_005);
    expect(parseIrisBankAmount("$ 0.00")).toBe(0);
  });

  it("rechaza formatos que no son importes exactos", () => {
    expect(parseIrisBankAmount("$ 1.000,00")).toBeNull();
    expect(parseIrisBankAmount("$ 12")).toBeNull();
    expect(parseIrisBankAmount("5%")).toBeNull();
  });
});

describe("agrupación por descripción exacta + signo", () => {
  it("caso 1: misma descripción positiva", () => {
    const groups = groupMovements([m("Recaudos IrisPay", 100_00), m("Recaudos IrisPay", 200_00)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ description: "Recaudos IrisPay", sign: "positive", count: 2, totalCents: 300_00 });
  });

  it("caso 2: misma descripción negativa conserva el signo", () => {
    const groups = groupMovements([m("Pagos PSE a BANCOLOMBIA", -100_00), m("Pagos PSE a BANCOLOMBIA", -200_00)]);
    expect(groups[0]).toMatchObject({ sign: "negative", count: 2, totalCents: -300_00 });
  });

  it("caso 3: misma descripción con ambos signos → dos grupos, nunca neteados", () => {
    const groups = groupMovements([m("CONCEPTO A", 100_00), m("CONCEPTO A", -30_00)]);
    expect(groups.map((g) => [g.description, g.sign, g.count, g.totalCents])).toEqual([
      ["CONCEPTO A", "positive", 1, 100_00],
      ["CONCEPTO A", "negative", 1, -30_00],
    ]);
    const summary = summarize([m("CONCEPTO A", 100_00), m("CONCEPTO A", -30_00)], groups);
    expect(summary).toMatchObject({ conceptCount: 1, positiveGroups: 1, negativeGroups: 1, netCents: 70_00 });
  });

  it("caso 4: un cambio de palabra es otro grupo", () => {
    const groups = groupMovements([m("Pagos PSE a BANCOLOMBIA", -1_00), m("Pagos PSE a Banco de Bogota", -1_00), m("Pagos PSE a BANCO FALABELLA S A", -1_00), m("Pagos PSE a BANCO SERFINANZA SA", -1_00)]);
    expect(groups).toHaveLength(4);
  });
});

describe("parseIrisBankStatement", () => {
  it("lee día, referencia, descripción, movimiento, saldo y página", () => {
    const rows = chained([r("Pagos PSE a BANCOLOMBIA", -2_223_606_00), r("Recaudos IrisPay", 409_488_572_00, "02/01/26")], 40_549_400_47);
    const s = parseIrisBankStatement(statement([rows]));
    expect(s.movements).toHaveLength(2);
    expect(s.movements[0]).toMatchObject({
      date: "01/01/26",
      fullDate: "01/01/2026",
      description: "Pagos PSE a BANCOLOMBIA",
      valueCents: -2_223_606_00,
      balanceCents: 38_325_794_47,
      sign: "negative",
      page: 1,
    });
    expect(s.movements[0].document).toMatch(/^\d{7}$/);
    expect(s.movements[1]).toMatchObject({ description: "Recaudos IrisPay", valueCents: 409_488_572_00, sign: "positive" });
    expect(s).toMatchObject({ bank: "Iris Bank", accountNumber: "100656570983", periodFrom: "2026/01/01", periodTo: "2026/01/31" });
    expect(s.issues).toEqual([]);
  });

  it("lee el resumen de la primera página aunque comparta fila con otros datos", () => {
    const rows = chained([r("Pagos PSE a BANCOLOMBIA", -2_000_000_00), r("Recaudos IrisPay", 5_000_000_00)], 40_549_400_47);
    const s = parseIrisBankStatement(statement([rows], 40_549_400_47));
    expect(s.totals).toEqual({
      previousBalanceCents: 40_549_400_47,
      totalCreditsCents: 5_000_000_00,
      totalDebitsCents: 2_000_000_00,
      currentBalanceCents: 43_549_400_47,
    });
  });

  it("caso 6: descripción en dos líneas centradas se reconstruye como una sola", () => {
    const rows = chained(
      [r("Pagos PSE a BANCOLOMBIA", -1_000_00), r(["Pagos PSE a FIDUCIARIA BANCOLOMBIA S A", "SOCIEDAD FIDUCIARIA"], -124_959_00), r("Pagos PSE a BANCOLOMBIA", -2_000_00)],
      10_000_000_00,
    );
    const s = parseIrisBankStatement(statement([rows]));
    expect(s.movements.map((x) => x.description)).toEqual([
      "Pagos PSE a BANCOLOMBIA",
      "Pagos PSE a FIDUCIARIA BANCOLOMBIA S A SOCIEDAD FIDUCIARIA",
      "Pagos PSE a BANCOLOMBIA",
    ]);
    expect(s.joinedLines).toBe(2);
    expect(s.issues).toEqual([]);
  });

  it("descripción en tres líneas, también como primera y última fila de la página", () => {
    const rows = chained([r(["LÍNEA UNO", "LÍNEA DOS", "LÍNEA TRES"], -1_00), r("Recaudos IrisPay", 5_00), r(["Pagos PSE a", "OTRA ENTIDAD"], -2_00)], 1_000_00);
    const s = parseIrisBankStatement(statement([rows]));
    expect(s.movements.map((x) => x.description)).toEqual(["LÍNEA UNO LÍNEA DOS LÍNEA TRES", "Recaudos IrisPay", "Pagos PSE a OTRA ENTIDAD"]);
    expect(s.issues).toEqual([]);
  });

  it("casos 7, 8 y 10: muchas páginas, encabezado repetido, tasas y pie ignorados, sin duplicados", () => {
    const pages: Omit<Row, "balance">[][] = Array.from({ length: 69 }, (_, p) =>
      Array.from({ length: p === 0 ? 5 : 15 }, (_, i) => r(i % 4 === 0 ? "Recaudos IrisPay" : "Pagos PSE a BANCOLOMBIA", i % 4 === 0 ? 1_000_000_00 + p : -(10_000_00 + i))),
    );
    let balance = 50_000_000_00;
    const withBalance = pages.map((rows) => rows.map((x) => ({ ...x, balance: (balance += x.cents) })));
    const doc = statement(withBalance, 50_000_000_00);
    const { statement: s, validation } = analyzeIrisBank(doc);

    expect(s.movements).toHaveLength(5 + 68 * 15);
    expect(Object.keys(s.movementsByPage)).toHaveLength(69);
    expect(s.movementsByPage[69]).toBe(15);
    expect(new Set(s.movements.map((x) => x.document)).size).toBe(s.movements.length);
    for (const x of s.movements) expect(x.description).not.toMatch(/DESCRIPCIÓN|PLAN ACTUAL|TASA|página/);
    expect(s.issues).toEqual([]);
    for (const check of validation.checks) expect(check, check.detail).toMatchObject({ status: "ok" });
    expect(validation.validated).toBe(true);
  });

  it("no acepta un PDF de otro banco", () => {
    const doc: PdfDocumentText = { pageCount: 1, pages: [{ pageNumber: 1, width: 600, height: 800, items: [text("Fecha Valor Doc. Clase de Movimiento Oficina", 40, 600)] }] };
    expect(() => parseIrisBankStatement(doc)).toThrow(new StatementError(IRIS_BANK_MESSAGES.format));
  });

  it("sin la columna MOVIMIENTOS lo informa", () => {
    const doc = statement([chained([r("Recaudos IrisPay", 1_00)], 0)]);
    doc.pages[0].items = doc.pages[0].items.filter((i) => i.text !== "MOVIMIENTOS");
    expect(() => parseIrisBankStatement(doc)).toThrow(new StatementError(IRIS_BANK_MESSAGES.noMovementsColumn));
  });

  it("informa un importe ilegible en vez de inventarlo", () => {
    const doc = statement([chained([r("Recaudos IrisPay", 1_00), r("Pagos PSE a BANCOLOMBIA", -2_00)], 0)]);
    const bad = doc.pages[0].items.find((i) => i.text === "$ -2.00")!;
    bad.text = "$ -2.0O";
    const s = parseIrisBankStatement(doc);
    expect(s.movements).toHaveLength(1);
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0].reason).toMatch(/Movimientos/);
  });
});

describe("validateIrisBank", () => {
  it("caso 9: detecta un movimiento omitido por la secuencia de saldos y los totales", () => {
    const rows = chained([r("Recaudos IrisPay", 100_00), r("Pagos PSE a BANCOLOMBIA", -30_00), r("Pagos PSE a BANCOLOMBIA", -20_00)], 1_000_00);
    const doc = statement([rows]);
    // Se quita la fila del medio (como si el parser la hubiera perdido).
    const lost = rows[1];
    doc.pages[0].items = doc.pages[0].items.filter((i) => i.y !== doc.pages[0].items.find((x) => x.text === lost.ref)!.y);
    const s = parseIrisBankStatement(doc);
    const groups = groupMovements(s.movements);
    const v = validateIrisBank(s, groups, summarize(s.movements, groups));
    expect(v.validated).toBe(false);
    expect(v.checks.find((c) => c.id === "balances")?.status).toBe("failed");
    expect(v.checks.find((c) => c.id === "debits")?.status).toBe("failed");
    expect(v.checks.find((c) => c.id === "credits")?.status).toBe("ok");
    // Los datos extraídos no se modifican para forzar la coincidencia.
    expect(s.movements.map((x) => x.valueCents)).toEqual([100_00, -20_00]);
  });

  it("sin resumen no se marca como validado", () => {
    const s = parseIrisBankStatement(statement([chained([r("Recaudos IrisPay", 100_00)], 0)], 0, false));
    const groups = groupMovements(s.movements);
    const v = validateIrisBank(s, groups, summarize(s.movements, groups));
    expect(v.validated).toBe(false);
    expect(v.checks.find((c) => c.id === "credits")?.status).toBe("unavailable");
  });
});

describe("buildIrisBankSheets", () => {
  it("caso 11: Resumen y Movimientos con referencia, tipo, saldo y página", () => {
    const { statement: s, groups } = analyzeIrisBank(statement([chained([r("Recaudos IrisPay", 100_00), r("Recaudos IrisPay", -40_00)], 0)]));
    const [summary, detail] = buildIrisBankSheets(s, groups);
    expect(summary.columns.map((c) => c.header)).toEqual(["Descripción", "Tipo", "Cantidad", "Total"]);
    expect(summary.rows).toEqual([
      ["Recaudos IrisPay", "Positivo", 1, 100],
      ["Recaudos IrisPay", "Negativo", 1, -40],
    ]);
    expect(detail.columns.map((c) => c.header)).toEqual(["Día", "Referencia", "Descripción", "Movimiento", "Tipo", "Saldo", "Página"]);
    expect(detail.rows[1]).toEqual(["01/01/2026", s.movements[1].document, "Recaudos IrisPay", -40, "Negativo", 60, 1]);
  });
});
