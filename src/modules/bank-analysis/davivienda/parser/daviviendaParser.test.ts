import { describe, expect, it } from "vitest";
import { groupMovements } from "../../shared/groupingService";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../shared/pdf/pdfTypes";
import { summarize } from "../../shared/summaryService";
import { StatementError, type BankMovement } from "../../shared/types";
import { analyzeDavivienda } from "../services/analysis";
import { buildDaviviendaSheets } from "../services/excelExport";
import { validateDavivienda } from "../services/validation";
import { DAVIVIENDA_MESSAGES, parseDaviviendaStatement, parseDaviviendaValue } from "./daviviendaParser";

// ---------------------------------------------------------------------------
// PDF sintético con la geometría del extracto Davivienda real: fuente
// proporcional (~3,3 pt por carácter a 8 pt), valor alineado a la derecha en
// x≈178 con el signo como fragmento aparte, Oficina a 7 pt y ~1 pt más arriba.
// ---------------------------------------------------------------------------

const CW = 3.3;
const text = (t: string, x: number, y: number, height = 8): PdfTextItem => ({ text: t, x, y, width: t.length * CW, height });

const HEADER_Y = 470.9;
const header = (y = HEADER_Y) => [
  { text: "Fecha", x: 55.7, y, width: 19, height: 8 },
  { text: "Valor", x: 126.4, y, width: 16.4, height: 8 },
  { text: "Doc.", x: 197, y, width: 14.2, height: 8 },
  { text: "Clase de Movimiento", x: 301.8, y, width: 65.2, height: 8 },
  { text: "Oficina", x: 501.9, y, width: 22.2, height: 8 },
];

interface Row {
  date: string; // "DD MM"
  value: string; // "$ 2,900,000.00"
  sign: "+" | "-" | "";
  doc: string;
  movementClass: string;
  office: string;
  /** Segunda línea de la clase (sin fecha, valor ni documento). */
  classLine2?: string;
  /** Signo pegado al valor en el mismo fragmento. */
  signAttached?: boolean;
}

const row = (date: string, value: string, sign: Row["sign"], movementClass: string, office = "App Davivienda", extra: Partial<Row> = {}): Row => ({
  date,
  value,
  sign,
  doc: "1234",
  movementClass,
  office,
  ...extra,
});

function tableItems(rows: Row[], startY = HEADER_Y - 14, pitch = 9.3): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  let y = startY;
  for (const r of rows) {
    const [dd, mm] = r.date.split(" ");
    items.push(text(dd, 52.3, y), text(mm, 71.5, y));
    if (r.signAttached) items.push(text(`${r.value}${r.sign}`, 178.2 + 4 - (r.value.length + 1) * CW, y));
    else {
      items.push(text(r.value, 178.2 - r.value.length * CW, y));
      if (r.sign) items.push({ text: r.sign, x: r.sign === "+" ? 178.2 : 180.2, y, width: r.sign === "+" ? 4.7 : 2.7, height: 8 });
    }
    items.push(text(r.doc, 196.8, y), text(r.movementClass, 224.2, y), text(r.office, 450.7, y + 0.9, 7));
    if (r.classLine2) {
      y -= 9.1;
      items.push(text(r.classLine2, 224.2, y));
    }
    y -= pitch;
  }
  return items;
}

const SUMMARY: [string, string][] = [
  ["Saldo Anterior", "$1,000.00"],
  ["Más Créditos", "$300.00"],
  ["Menos Débitos", "$50.00"],
  ["Nuevo Saldo", "$1,250.00"],
  ["Saldo Promedio", "$1,100.00"],
];

function page(pageNumber: number, items: PdfTextItem[], { first = pageNumber === 1, headerY = HEADER_Y, summary = SUMMARY } = {}): PdfPageText {
  const top: PdfTextItem[] = first
    ? [
        text("CUENTA DE AHORROS", 249, 725.7, 14),
        text("1089 0037 0629", 280.1, 712.4, 11),
        text("INFORME DEL MES:", 405, 701.1),
        text("ENERO /2026", 470.5, 700.7, 10),
        ...summary.flatMap(([label, amount], i) => [text(label, 232.4, 564.6 - i * 15.1), text(amount, 346.8, 562.5 - i * 15.1, 9)]),
      ]
    : [text("CUENTA DE AHORROS", 250.9, 733.4, 14)];
  return {
    pageNumber,
    width: 612,
    height: 792,
    items: [
      ...top,
      ...header(headerY),
      ...items,
      text("Este producto cuenta con seguro de depósitos", 262.5, 93.5, 6),
      text("Recuerde que usted también cuenta con nuestro Defensor del Consumidor Financiero", 102.9, 79.7, 6),
      text("Banco Davivienda S.A NIT.860.034.313-7", 48.2, 22.8, 7),
    ],
  };
}

const doc = (...pages: PdfPageText[]): PdfDocumentText => ({ pageCount: pages.length, pages });

const movement = (description: string, valueCents: number, index = 0): BankMovement => ({
  index,
  date: "02 01",
  description,
  valueCents,
  page: 1,
  sign: valueCents > 0 ? "positive" : valueCents < 0 ? "negative" : "zero",
});

// ---------------------------------------------------------------------------

describe("valor con signo al final", () => {
  it("convierte a centavos con coma de miles y punto decimal", () => {
    expect(parseDaviviendaValue("$ 2,900,000.00+")).toBe(290_000_000);
    expect(parseDaviviendaValue("$ 742,942.68-")).toBe(-74_294_268);
    expect(parseDaviviendaValue("$1,701.52+")).toBe(170_152);
    expect(parseDaviviendaValue("28,443.00-")).toBe(-2_844_300);
  });

  it("sin signo o con formato distinto no se interpreta", () => {
    expect(parseDaviviendaValue("$ 2,900,000.00")).toBeNull();
    expect(parseDaviviendaValue("$ 2.900.000,00+")).toBeNull();
    expect(parseDaviviendaValue("abc+")).toBeNull();
  });
});

describe("agrupación por clase exacta + signo", () => {
  it("caso 1: misma clase positiva", () => {
    const groups = groupMovements([movement("CLASE A", 10000), movement("CLASE A", 20000, 1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ description: "CLASE A", sign: "positive", count: 2, totalCents: 30000 });
  });

  it("caso 2: misma clase negativa", () => {
    const groups = groupMovements([movement("CLASE A", -10000), movement("CLASE A", -20000, 1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ sign: "negative", count: 2, totalCents: -30000 });
  });

  it("caso 3: misma clase con ambos signos no se netea", () => {
    const groups = groupMovements([movement("CLASE A", 10000), movement("CLASE A", -3000, 1)]);
    expect(groups.map((g) => [g.description, g.sign, g.count, g.totalCents])).toEqual([
      ["CLASE A", "positive", 1, 10000],
      ["CLASE A", "negative", 1, -3000],
    ]);
    const summary = summarize(groups.flatMap((g) => g.movements), groups);
    expect(summary).toMatchObject({ conceptCount: 1, positiveGroups: 1, negativeGroups: 1, netCents: 7000 });
  });

  it("caso 4: una letra de diferencia crea otro grupo", () => {
    const groups = groupMovements([movement("Abono Transferencia", 100), movement("Abono Transferencias", 100, 1)]);
    expect(groups).toHaveLength(2);
  });
});

describe("parser Davivienda", () => {
  const rows = [
    row("02 01", "$ 2,900,000.00", "+", "Abono Transferencia 550457200205625 80072168"),
    row("02 01", "$ 2,000,000.00", "-", "Pagos por Internet BANCOLOMBIA", "Compras y Pagos PSE"),
    row("06 01", "$ 9,101,845.00", "-", "Dcto por Transferencia de Fondos 550009570379611 9017411869", "PORTAL PYMES", { classLine2: "TRANSFERENCIA TERCEROS" }),
    row("31 01", "$ 1,701.52", "+", "Rendimientos Financieros.", "0000", { signAttached: true }),
  ];

  it("caso 5: signo separado o pegado al valor", () => {
    const s = parseDaviviendaStatement(doc(page(1, tableItems(rows))));
    expect(s.movements.map((m) => m.valueCents)).toEqual([290_000_000, -200_000_000, -910_184_500, 170_152]);
    expect(s.movements.map((m) => m.sign)).toEqual(["positive", "negative", "negative", "positive"]);
  });

  it("caso 6: clase en dos líneas se reconstruye completa", () => {
    const s = parseDaviviendaStatement(doc(page(1, tableItems(rows))));
    expect(s.movements[2].description).toBe("Dcto por Transferencia de Fondos 550009570379611 9017411869 TRANSFERENCIA TERCEROS");
    expect(s.movements).toHaveLength(4);
    expect(s.joinedLines).toBe(1);
  });

  it("caso 7: la Oficina no entra en la clase", () => {
    const s = parseDaviviendaStatement(doc(page(1, tableItems(rows))));
    expect(s.movements[1]).toMatchObject({ description: "Pagos por Internet BANCOLOMBIA", branch: "Compras y Pagos PSE", document: "1234" });
    expect(s.movements[2].branch).toBe("PORTAL PYMES");
  });

  it("caso 8 y 9: varias páginas sin reiniciar ni procesar encabezados repetidos", () => {
    const p1 = page(1, tableItems(rows.slice(0, 2)));
    const p2 = page(2, tableItems(rows.slice(2, 3), 645.1), { headerY: 659.1 });
    const p3 = page(3, tableItems(rows.slice(3), 645.1), { headerY: 659.1 });
    const s = parseDaviviendaStatement(doc(p1, p2, p3));
    expect(s.movementsByPage).toEqual({ 1: 2, 2: 1, 3: 1 });
    expect(s.movements.map((m) => m.index)).toEqual([0, 1, 2, 3]);
    expect(s.movements.map((m) => m.page)).toEqual([1, 1, 2, 3]);
    for (const m of s.movements) expect(m.description).not.toMatch(/Fecha|Clase de Movimiento|Oficina$|Defensor|seguro de dep/);
    expect(s.issues).toEqual([]);
  });

  it("lee cuenta, periodo, fechas completas y el resumen", () => {
    const s = parseDaviviendaStatement(doc(page(1, tableItems(rows))));
    expect(s).toMatchObject({ bank: "Davivienda", accountNumber: "1089 0037 0629", periodFrom: "2026/01/01", periodTo: "2026/01/31" });
    expect(s.movements[0].fullDate).toBe("02/01/2026");
    expect(s.totals).toEqual({ previousBalanceCents: 100_000, totalCreditsCents: 30_000, totalDebitsCents: 5_000, currentBalanceCents: 125_000 });
  });

  it("valor sin signo queda para revisión, sin inventar el signo", () => {
    const bad = [...rows.slice(0, 1), row("03 01", "$ 5,000.00", "", "Compra X", "FRANQUICIA MASTER CARD")];
    const s = parseDaviviendaStatement(doc(page(1, tableItems(bad))));
    expect(s.movements).toHaveLength(1);
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0].reason).toMatch(/\+ o -/);
  });

  it("rechaza PDF de otro banco o sin tabla", () => {
    const other: PdfDocumentText = { pageCount: 1, pages: [{ pageNumber: 1, width: 612, height: 792, items: [text("Bancolombia", 10, 10)] }] };
    expect(() => parseDaviviendaStatement(other)).toThrow(DAVIVIENDA_MESSAGES.format);
    const noTable: PdfDocumentText = { pageCount: 1, pages: [{ pageNumber: 1, width: 612, height: 792, items: [text("Banco Davivienda", 10, 10)] }] };
    expect(() => parseDaviviendaStatement(noTable)).toThrow(StatementError);
  });
});

describe("caso 10: conciliación contra el resumen", () => {
  const rows = [
    row("02 01", "$ 200.00", "+", "CLASE A"),
    row("03 01", "$ 100.00", "+", "CLASE A"),
    row("04 01", "$ 50.00", "-", "CLASE A", "PORTAL PYMES"),
  ];

  it("valida cuando los movimientos cuadran con Más Créditos, Menos Débitos y Nuevo Saldo", () => {
    const a = analyzeDavivienda(doc(page(1, tableItems(rows))));
    for (const c of a.validation.checks) expect(c, c.detail).toMatchObject({ status: "ok" });
    expect(a.validation.validated).toBe(true);
    expect(a.groups.map((g) => [g.sign, g.count, g.totalCents])).toEqual([
      ["positive", 2, 30_000],
      ["negative", 1, -5_000],
    ]);
  });

  it("advierte sin modificar datos cuando falta un movimiento", () => {
    const a = analyzeDavivienda(doc(page(1, tableItems(rows.slice(0, 2)))));
    expect(a.validation.validated).toBe(false);
    expect(a.validation.checks.find((c) => c.id === "debits")?.status).toBe("failed");
    expect(a.statement.movements).toHaveLength(2);
  });

  it("detecta un resumen incoherente", () => {
    const summary: [string, string][] = [...SUMMARY.slice(0, 3), ["Nuevo Saldo", "$9,999.00"]];
    const a = analyzeDavivienda(doc(page(1, tableItems(rows), { summary })));
    expect(a.validation.checks.find((c) => c.id === "summary")?.status).toBe("failed");
    expect(a.validation.validated).toBe(false);
  });

  it("error de agrupación impide validar", () => {
    const a = analyzeDavivienda(doc(page(1, tableItems(rows))));
    const broken = a.groups.map((g, i) => (i === 0 ? { ...g, totalCents: g.totalCents + 1 } : g));
    const v = validateDavivienda(a.statement, broken, a.summary);
    expect(v.checks.find((c) => c.id === "grouping")?.status).toBe("failed");
    expect(v.validated).toBe(false);
  });
});

describe("caso 11: exportación", () => {
  it("conserva clase, signo, cantidad, total y movimientos individuales", () => {
    const rows = [
      row("02 01", "$ 200.00", "+", "CLASE A"),
      row("03 01", "$ 50.00", "-", "CLASE A", "PORTAL PYMES", { classLine2: "SEGUNDA LINEA" }),
    ];
    const a = analyzeDavivienda(doc(page(1, tableItems(rows))));
    const [summary, detail] = buildDaviviendaSheets(a.statement, a.groups);
    expect(summary.columns.map((c) => c.header)).toEqual(["Clase de Movimiento", "Tipo", "Cantidad", "Total"]);
    expect(summary.rows).toEqual([
      ["CLASE A", "Positivo", 1, 200],
      ["CLASE A SEGUNDA LINEA", "Negativo", 1, -50],
    ]);
    expect(detail.columns.map((c) => c.header)).toEqual(["Fecha", "Valor", "Tipo", "Clase de Movimiento", "Doc.", "Oficina", "Página"]);
    expect(detail.rows).toEqual([
      ["02/01/2026", 200, "Positivo", "CLASE A", "1234", "App Davivienda", 1],
      ["03/01/2026", -50, "Negativo", "CLASE A SEGUNDA LINEA", "1234", "PORTAL PYMES", 1],
    ]);
  });
});
