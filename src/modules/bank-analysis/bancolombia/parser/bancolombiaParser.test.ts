import { describe, expect, it } from "vitest";
import { groupMovements, sortGroups } from "../../shared/groupingService";
import { parseStatementAmount } from "../../shared/money";
import { validateStatement } from "../../shared/movementValidator";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../shared/pdf/pdfTypes";
import { summarize } from "../../shared/summaryService";
import { StatementError, type BankMovement } from "../../shared/types";
import { BANCOLOMBIA_MESSAGES, parseBancolombiaStatement } from "./bancolombiaParser";

// ---------------------------------------------------------------------------
// PDF sintético con la geometría del formato Bancolombia (fuente monoespaciada
// de 4,8 pt por carácter; VALOR y SALDO alineados a la derecha).
// ---------------------------------------------------------------------------

const CW = 4.8;
const mono = (text: string, x: number, y: number): PdfTextItem => ({ text, x, y, width: text.length * CW, height: 8 });
const right = (text: string, rightEdge: number, y: number) => mono(text, rightEdge - text.length * CW, y);
const bold = (text: string, x: number, width: number, y: number): PdfTextItem => ({ text, x, y, width, height: 9 });

const HEADER_Y = 600;
const header = (y = HEADER_Y) => [
  bold("FECHA", 31.5, 31, y),
  bold("DESCRIPCIÓN", 132.3, 62.5, y),
  bold("SUCURSAL", 269.5, 50, y),
  bold("DCTO.", 355.1, 27.8, y),
  bold("VALOR", 434.1, 30.8, y),
  bold("SALDO", 533.8, 31.5, y),
];

type Row = [date: string, description: string, value: string, balance: string];

/** Filas como las escribe el PDF: fila por fila, o columna por columna (byColumns). */
function tableItems(rows: Row[], { byColumns = false, startY = HEADER_Y - 15, pitch = 9 } = {}): PdfTextItem[] {
  const cells = rows.map(([date, desc, value, balance], i) => {
    const y = startY - i * pitch;
    return [right(date, 56.6, y), mono(desc, 79, y), right(value, 501, y), right(balance, 597, y)];
  });
  if (!byColumns) return cells.flat();
  return [0, 1, 2, 3].flatMap((col) => cells.map((c) => c[col]));
}

function page(pageNumber: number, items: PdfTextItem[]): PdfPageText {
  return {
    pageNumber,
    width: 612,
    height: 792,
    items: [
      mono("DCF:defensor@bancolombia.com.co;www.bancolombia.com/personas/defensor-financiero", 107, 19),
      mono("PÁGINA:", 530, 7),
      mono(String(pageNumber), 575, 7),
      mono("DESDE: 2025/12/31", 332, 699),
      mono("HASTA:", 450, 699),
      mono("2026/01/31", 490, 699),
      mono("NÚMERO", 332, 665),
      mono("55400011369", 400, 665),
      ...items,
    ],
  };
}

function resumen(previous: string, credits: string, debits: string, current: string): PdfTextItem[] {
  return [
    mono("RESUMEN", 287, 690),
    ...[
      ["SALDO ANTERIOR", previous],
      ["TOTAL ABONOS", credits],
      ["TOTAL CARGOS", debits],
      ["SALDO ACTUAL", current],
    ].flatMap(([label, value], i) => [mono(label, 45, 680 - i * 15), mono("$", 140, 680 - i * 15), right(value, 280, 680 - i * 15)]),
  ];
}

const doc = (...pages: PdfPageText[]): PdfDocumentText => ({ pageCount: pages.length, pages });

function analyze(d: PdfDocumentText) {
  const statement = parseBancolombiaStatement(d);
  const groups = groupMovements(statement.movements);
  const summary = summarize(statement.movements, groups);
  return { statement, groups, summary, validation: validateStatement(statement, groups, summary) };
}

const table = (groups: ReturnType<typeof groupMovements>) => groups.map((g) => [g.description, g.sign, g.count, g.totalCents]);

// Movimientos sin PDF, para probar la agrupación directamente.
let seq = 0;
function mv(description: string, value: string): BankMovement {
  const valueCents = parseStatementAmount(value)!;
  return { index: seq++, date: "1/01", description, valueCents, page: 1, sign: valueCents > 0 ? "positive" : valueCents < 0 ? "negative" : "zero" };
}

// ---------------------------------------------------------------------------

describe("importes del extracto", () => {
  it("convierte a centavos respetando coma de miles y punto decimal (caso 9)", () => {
    expect(parseStatementAmount("1.29")).toBe(129);
    expect(parseStatementAmount("621.78")).toBe(62178);
    expect(parseStatementAmount("-126,530.60")).toBe(-12653060);
    expect(parseStatementAmount("3,791,445.00")).toBe(379144500);
    expect(parseStatementAmount(".00")).toBe(0);
    expect(parseStatementAmount("-.04")).toBe(-4);
  });

  it("rechaza textos que no son importes del extracto", () => {
    for (const bad of ["1,29", "3.791.445,00", "12", "1.2", "4X1000", "55400008286", "1,23.00", ""]) expect(parseStatementAmount(bad)).toBeNull();
  });
});

describe("agrupación estricta", () => {
  it("caso 1: descripciones idénticas positivas", () => {
    expect(table(groupMovements([mv("TRANSFERENCIA CTA SUC VIRTUAL", "100.00"), mv("TRANSFERENCIA CTA SUC VIRTUAL", "200.00")]))).toEqual([
      ["TRANSFERENCIA CTA SUC VIRTUAL", "positive", 2, 30000],
    ]);
  });

  it("caso 2: descripciones idénticas negativas conservan el signo", () => {
    expect(table(groupMovements([mv("TRANSFERENCIA CTA SUC VIRTUAL", "-100.00"), mv("TRANSFERENCIA CTA SUC VIRTUAL", "-200.00")]))).toEqual([
      ["TRANSFERENCIA CTA SUC VIRTUAL", "negative", 2, -30000],
    ]);
  });

  it("caso 3: misma descripción con ambos signos → dos grupos, nunca un neto", () => {
    expect(table(groupMovements([mv("TRANSFERENCIA CTA SUC VIRTUAL", "100.00"), mv("TRANSFERENCIA CTA SUC VIRTUAL", "-200.00")]))).toEqual([
      ["TRANSFERENCIA CTA SUC VIRTUAL", "positive", 1, 10000],
      ["TRANSFERENCIA CTA SUC VIRTUAL", "negative", 1, -20000],
    ]);
  });

  it("ejemplo del enunciado: 13.000.000 positivo y -7.000.000 negativo", () => {
    const groups = groupMovements(
      ["10,000,000.00", "3,000,000.00", "-2,000,000.00", "-5,000,000.00"].map((v) => mv("TRANSFERENCIA CTA SUC VIRTUAL", v)),
    );
    expect(table(groups)).toEqual([
      ["TRANSFERENCIA CTA SUC VIRTUAL", "positive", 2, 1300000000],
      ["TRANSFERENCIA CTA SUC VIRTUAL", "negative", 2, -700000000],
    ]);
  });

  it("caso 4: una letra de diferencia son grupos distintos", () => {
    expect(groupMovements([mv("TRANSFERENCIA", "1.00"), mv("TRANSFERENCIAS", "1.00")])).toHaveLength(2);
  });

  it("caso 5: conceptos parecidos pero distintos no se unen", () => {
    expect(groupMovements([mv("IMPTO GOBIERNO 4X1000", "-1.00"), mv("CXC IMPTO GOBIERNO 4X1000 MON", "-1.00")])).toHaveLength(2);
    expect(groupMovements([mv("PAGO CXC DE CTA 55400008286", "-1.00"), mv("PAGO CXC DE CTA 55400001234", "-1.00")])).toHaveLength(2);
  });

  it("solo normaliza espacios; no cambia mayúsculas ni caracteres", () => {
    expect(groupMovements([mv("  ABONO   INTERESES ", "1.00"), mv("ABONO INTERESES", "1.00")])).toHaveLength(1);
    expect(groupMovements([mv("Abono intereses", "1.00"), mv("ABONO INTERESES", "1.00")])).toHaveLength(2);
  });

  it("valores cero forman su propio grupo", () => {
    expect(table(groupMovements([mv("AJUSTE", ".00"), mv("AJUSTE", "1.00")]))).toEqual([
      ["AJUSTE", "positive", 1, 100],
      ["AJUSTE", "zero", 1, 0],
    ]);
  });

  it("caso 10: la suma de grupos es exactamente la suma de movimientos, con centavos", () => {
    const values = ["1.29", "621.78", "-126,530.60", "-.04", "3,791,445.00", "-100,000.00", "-50,000.00", "-25,000.00"];
    const movements = values.map((v, i) => mv(i % 2 ? "A" : "B", v));
    const groups = groupMovements(movements);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(groups.map((g) => g.totalCents))).toBe(sum(movements.map((m) => m.valueCents)));
  });

  it("ordena por total y mantiene positivo antes que negativo en empates", () => {
    const groups = groupMovements([mv("B", "5.00"), mv("A", "-5.00"), mv("A", "5.00"), mv("C", "1.00"), mv("C", "1.00")]);
    expect(sortGroups(groups, "count", "desc").map((g) => g.key)).toEqual(["C|positive", "A|positive", "A|negative", "B|positive"]);
    expect(sortGroups(groups, "total", "asc").map((g) => g.key)).toEqual(["A|negative", "C|positive", "A|positive", "B|positive"]);
  });
});

describe("parser Bancolombia", () => {
  const page1Rows: Row[] = [
    ["1/01", "ABONO INTERESES AHORROS", "1.29", "945,866.62"],
    ["2/01", "TRANSFERENCIA DESDE NEQUI", "3,791,445.00", "4,737,311.62"],
    ["2/01", "IMPTO GOBIERNO 4X1000", "-126,530.60", "4,610,781.02"],
  ];
  const page2Rows: Row[] = [
    ["5/01", "CXC IMPTO GOBIERNO 4X1000 MON", "-23,402.39", "4,587,378.63"],
    ["8/01", "AJUSTE INTERES AHORROS DB", "-.04", "4,587,378.59"],
    ["22/01", "PAGO CXC DE CTA 55400008286", "-4,587,378.59", ".00"],
  ];
  const sample = (opts: { byColumns?: boolean } = {}) =>
    doc(
      page(1, [...resumen("945,865.33", "3,791,446.29", "4,737,311.62", ".00"), ...header(), ...tableItems(page1Rows)]),
      page(2, [...header(), ...tableItems(page2Rows, opts), mono("FIN ESTADO DE CUENTA", 79, HEADER_Y - 15 - 3 * 9)]),
    );

  it("casos 6, 7 y 8: lee todas las páginas, ignora encabezados repetidos y FIN ESTADO DE CUENTA", () => {
    const { statement, validation } = analyze(sample());
    expect(statement.movements.map((m) => [m.page, m.fullDate, m.description, m.valueCents, m.balanceCents])).toEqual([
      [1, "01/01/2026", "ABONO INTERESES AHORROS", 129, 94586662],
      [1, "02/01/2026", "TRANSFERENCIA DESDE NEQUI", 379144500, 473731162],
      [1, "02/01/2026", "IMPTO GOBIERNO 4X1000", -12653060, 461078102],
      [2, "05/01/2026", "CXC IMPTO GOBIERNO 4X1000 MON", -2340239, 458737863],
      [2, "08/01/2026", "AJUSTE INTERES AHORROS DB", -4, 458737859],
      [2, "22/01/2026", "PAGO CXC DE CTA 55400008286", -458737859, 0],
    ]);
    expect(statement.movementsByPage).toEqual({ 1: 3, 2: 3 });
    expect(statement.accountNumber).toBe("55400011369");
    expect(statement.totals).toEqual({ previousBalanceCents: 94586533, totalCreditsCents: 379144629, totalDebitsCents: 473731162, currentBalanceCents: 0 });
    expect(validation.validated).toBe(true);
  });

  it("reconstruye las filas aunque el PDF entregue el texto columna por columna", () => {
    const byRows = analyze(sample()).statement.movements;
    const byColumns = analyze(sample({ byColumns: true })).statement.movements;
    expect(byColumns).toEqual(byRows);
  });

  it("une una descripción partida en dos líneas del mismo movimiento", () => {
    const y = HEADER_Y - 15;
    const d = doc(
      page(1, [
        ...header(),
        ...tableItems([["2/01", "TRANSFERENCIA CTA SUC", "10.00", "10.00"]]),
        mono("VIRTUAL 123", 79, y - 9),
        ...tableItems([["3/01", "ABONO", "1.00", "11.00"]], { startY: y - 18 }),
      ]),
    );
    const { statement } = analyze(d);
    expect(statement.movements.map((m) => m.description)).toEqual(["TRANSFERENCIA CTA SUC VIRTUAL 123", "ABONO"]);
    expect(statement.joinedLines).toBe(1);
  });

  it("no toma como movimientos el RESUMEN, los datos de la cuenta ni el pie de página", () => {
    const { statement } = analyze(sample());
    expect(statement.movements).toHaveLength(6);
    expect(statement.issues).toEqual([]);
  });

  it("marca como no validado si el RESUMEN no coincide, sin alterar los movimientos", () => {
    const d = doc(page(1, [...resumen("945,865.33", "9.99", "4,737,311.62", ".00"), ...header(), ...tableItems(page1Rows)]));
    const { statement, validation } = analyze(d);
    expect(statement.movements).toHaveLength(3);
    expect(validation.validated).toBe(false);
    expect(validation.checks.find((c) => c.id === "credits")?.status).toBe("failed");
  });

  it("detecta saltos en la secuencia de saldos (fila omitida o mal leída)", () => {
    const rows: Row[] = [page1Rows[0], page1Rows[2]]; // falta la fila del medio
    const { validation } = analyze(doc(page(1, [...resumen("945,865.33", "1.29", "126,530.60", ".00"), ...header(), ...tableItems(rows)])));
    expect(validation.checks.find((c) => c.id === "balances")?.status).toBe("failed");
    expect(validation.validated).toBe(false);
  });

  it("reporta filas con valor no interpretable en lugar de inventar datos", () => {
    const d = doc(page(1, [...header(), ...tableItems([["2/01", "ABONO", "1,00", "1.00"], page1Rows[0]])]));
    const { statement, validation } = analyze(d);
    expect(statement.movements).toHaveLength(1);
    expect(statement.issues).toHaveLength(1);
    expect(validation.validated).toBe(false);
  });

  it("caso 11: un PDF de otro formato no genera datos", () => {
    const other = doc({ pageNumber: 1, width: 612, height: 792, items: [mono("FACTURA ELECTRONICA DE VENTA", 50, 700), mono("TOTAL 1,000.00", 50, 600)] });
    expect(() => parseBancolombiaStatement(other)).toThrow(new StatementError(BANCOLOMBIA_MESSAGES.format));
    const noTable = doc(page(1, [mono("CERTIFICADO BANCARIO", 50, 500)]));
    expect(() => parseBancolombiaStatement(noTable)).toThrow(BANCOLOMBIA_MESSAGES.format);
  });

  it("informa si no hay movimientos o si falta la columna VALOR", () => {
    expect(() => parseBancolombiaStatement(doc(page(1, header())))).toThrow(BANCOLOMBIA_MESSAGES.noMovements);
    const noValor = header().filter((i) => i.text !== "VALOR");
    expect(() => parseBancolombiaStatement(doc(page(1, noValor)))).toThrow(BANCOLOMBIA_MESSAGES.noValueColumn);
  });
});
