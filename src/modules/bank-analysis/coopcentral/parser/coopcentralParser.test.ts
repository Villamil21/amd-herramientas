import { describe, expect, it } from "vitest";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../shared/pdf/pdfTypes";
import { StatementError } from "../../shared/types";
import { analyzeCoopcentral } from "../services/analysis";
import { buildCoopcentralSheets, suggestedCoopcentralName } from "../services/excelExport";
import { groupCoopcentralMovements, sortCoopcentralGroups, summarizeCoopcentral } from "../services/grouping";
import { RECONCILIATION_WARNING, groupIssues, issuesTitle } from "../services/validation";
import type { CoopcentralMovement } from "../types";
import { COOPCENTRAL_MESSAGES, parseCoopcentralMoney, parseCoopcentralStatement } from "./coopcentralParser";

// ---------------------------------------------------------------------------
// PDF sintético con la geometría del formato Coopcentral (fuente monoespaciada
// de 3 pt por carácter en la tabla; CREDITOS, DEBITOS y SALDO alineados a la
// derecha).
// ---------------------------------------------------------------------------

const mono = (text: string, x: number, y: number, cw = 3, height = 5): PdfTextItem => ({ text, x, y, width: text.length * cw, height });
const right = (text: string, rightEdge: number, y: number) => mono(text, rightEdge - text.length * 3, y);
const title = (text: string, x: number, y: number) => mono(text, x, y, 4.8, 8);
/**
 * Celda de importe. Con "- 211,048,700.00" (signo, espacio, número) el signo
 * sale como un texto aparte en el borde izquierdo de la celda, como en los
 * extractos reales con saldo negativo.
 */
const amountCell = (text: string, rightEdge: number, y: number, signX: number) => {
  const m = /^([-\u2212]) (.+)$/.exec(text);
  return m ? [mono(m[1], signX, y), right(m[2], rightEdge, y)] : [right(text, rightEdge, y)];
};

const header = (y = 600) => [
  title("CONCEPTO", 67.8, y),
  title("DOCT", 128.4, y),
  title("OFICINA", 153.2, y),
  title("F.APLI", 195.6, y),
  title("F.OPER", 236.6, y),
  title("TRANS.", 275, y),
  title("ELECTRONICA", 308.6, y),
  title("CREDITOS", 380.8, y),
  title("DEBITOS", 458.2, y),
  title("SALDO", 533, y),
  title("TR.NAC.", 153.2, y - 10),
  title("(A/M/D)", 193.2, y - 10),
  title("(A/M/D)", 234.2, y - 10),
  title("PAQUETE-LOTE-TRANS", 275, y - 10),
];

type Row = [concept: string, doc: string, credit: string, debit: string, balance: string, trans?: string];

function tableItems(rows: Row[], { startY = 570, pitch = 7, byColumns = false } = {}): PdfTextItem[] {
  const cells = rows.map(([concept, doc, credit, debit, balance, trans], i) => {
    const y = startY - i * pitch;
    const special = /^SALDO (INICIAL|FINAL)$/.test(concept);
    return [
      mono(concept, 47, y),
      mono(doc, 130, y),
      ...(special ? [] : [mono("2026/02/10", 195, y), mono("2026/02/11", 235, y)]),
      ...(trans ? [mono(trans, 275, y)] : []),
      ...amountCell(credit, 435, y, 422),
      ...amountCell(debit, 510, y, 440),
      ...amountCell(balance, 583, y, 517),
    ];
  });
  if (!byColumns) return cells.flat();
  const width = Math.max(...cells.map((c) => c.length));
  return Array.from({ length: width }, (_, col) => cells.flatMap((c) => (c[col] ? [c[col]] : []))).flat();
}

const footer = (totals: [string, string][] = []) => [
  mono("Cualquier inconformidad comunicarla a nuestros", 55, 170, 4.2, 7),
  mono("TOTALES DEL PERIODO AGRUPADOS POR CONCEPTO", 330, 170, 4.2, 7),
  ...totals.flatMap(([label, value], i) => [mono(label, 330, 160 - i * 8, 4.2, 7), mono(value, 580 - value.length * 4.2, 160 - i * 8, 4.2, 7)]),
  mono("reportarla al contacto antifraude@coopcentral.com.co", 55, 116, 4.2, 7),
  mono("Pág. 1", 302.4, 30, 4.2, 7),
];

function page(pageNumber: number, items: PdfTextItem[], totals: [string, string][] = []): PdfPageText {
  return {
    pageNumber,
    width: 612,
    height: 792,
    items: [
      mono("EXTRACTO DE 2026/02/01", 55, 685, 4.8, 8),
      mono("HASTA", 165.4, 685, 4.8, 8),
      mono("2026/02/28", 194.2, 685, 4.8, 8),
      mono("NUMERO CUENTA: 431-00102-2", 55, 658, 4.8, 8),
      mono("OFICINA: BARRANQUILLA", 55, 631, 4.8, 8),
      ...items,
      ...footer(totals),
    ],
  };
}

const doc = (...pages: PdfPageText[]): PdfDocumentText => ({ pageCount: pages.length, pages });
const single = (rows: Row[], totals: [string, string][] = []) => doc(page(1, [...header(), ...tableItems(rows)], totals));

const OPEN: Row = ["SALDO INICIAL", "INIC.", "0.00", "0.00", "1,000.00"];
const close = (balance: string): Row => ["SALDO FINAL", "FINAL", "0.00", "0.00", balance];

const move = (concept: string, creditCents: number, debitCents: number, index = 0): CoopcentralMovement => ({
  index,
  concept,
  creditCents,
  debitCents,
  transactionType: creditCents > 0 ? "credit" : "debit",
  amountCents: creditCents || debitCents,
  page: 1,
});

// ---------------------------------------------------------------------------

describe("agrupación por concepto exacto + tipo", () => {
  it("caso 1: créditos del mismo concepto se suman", () => {
    const [g] = groupCoopcentralMovements([move("CONCEPTO A", 10000, 0), move("CONCEPTO A", 20000, 0)]);
    expect(g).toMatchObject({ concept: "CONCEPTO A", transactionType: "credit", count: 2, totalCents: 30000 });
  });

  it("caso 2: débitos del mismo concepto se suman", () => {
    const [g] = groupCoopcentralMovements([move("CONCEPTO A", 0, 10000), move("CONCEPTO A", 0, 20000)]);
    expect(g).toMatchObject({ transactionType: "debit", count: 2, totalCents: 30000 });
  });

  it("caso 3: mismo concepto en crédito y débito son dos grupos, nunca un neto", () => {
    const groups = groupCoopcentralMovements([move("CONCEPTO A", 10000, 0), move("CONCEPTO A", 5000, 0), move("CONCEPTO A", 0, 3000)]);
    expect(groups.map((g) => [g.concept, g.transactionType, g.count, g.totalCents])).toEqual([
      ["CONCEPTO A", "credit", 2, 15000],
      ["CONCEPTO A", "debit", 1, 3000],
    ]);
    const summary = summarizeCoopcentral(groups.flatMap((g) => g.movements), groups);
    expect(summary).toMatchObject({ conceptCount: 1, creditGroups: 1, debitGroups: 1, totalCreditsCents: 15000, totalDebitsCents: 3000, netCents: 12000 });
  });

  it("caso 4: conceptos que difieren en una letra no se unen", () => {
    const groups = groupCoopcentralMovements([move("NOTA CREDITO", 100, 0), move("NOTAS CREDITO", 100, 0)]);
    expect(groups.map((g) => g.concept)).toEqual(["NOTA CREDITO", "NOTAS CREDITO"]);
  });

  it("NC TRAN ELEC INTERNA y NC TRANSACCION ELECT son grupos distintos", () => {
    expect(groupCoopcentralMovements([move("NC TRAN ELEC INTERNA", 100, 0), move("NC TRANSACCION ELECT", 100, 0)])).toHaveLength(2);
  });

  it("ordena por concepto A-Z por defecto y permite ordenar por tipo, cantidad y total", () => {
    const groups = groupCoopcentralMovements([move("B", 0, 500), move("A", 0, 100), move("A", 900, 0), move("B", 0, 1)]);
    expect(groups.map((g) => `${g.concept}${g.transactionType[0]}`)).toEqual(["Ac", "Ad", "Bd"]);
    expect(sortCoopcentralGroups(groups, "type", "desc").map((g) => g.transactionType)).toEqual(["debit", "debit", "credit"]);
    expect(sortCoopcentralGroups(groups, "count", "desc")[0].concept).toBe("B");
    expect(sortCoopcentralGroups(groups, "total", "desc")[0].totalCents).toBe(900);
  });
});

describe("parser Coopcentral", () => {
  const rows: Row[] = [
    OPEN,
    ["NC TRAN ELEC INTERNA", "TRETN", "337,208,000.00", "0.00", "337,209,000.00", "NO PAQ.-0004995138-0034254764"],
    ["TDB-POS", "37564", "0.00", "337,300,000.00", "-91,000.00"],
    ["INTERESES PAGADOS", "10000", "68,685.00", "0.00", "-22,315.00"],
    ["RETEFUENTE", "10000", "0.00", "4,807.95", "-27,122.95"],
    close("-27,122.95"),
  ];

  it("el tipo sale de la columna con valor, no del texto del concepto", () => {
    const s = parseCoopcentralStatement(single(rows));
    expect(s.movements.map((m) => [m.concept, m.transactionType, m.amountCents])).toEqual([
      ["NC TRAN ELEC INTERNA", "credit", 33720800000],
      ["TDB-POS", "debit", 33730000000],
      ["INTERESES PAGADOS", "credit", 6868500],
      ["RETEFUENTE", "debit", 480795],
    ]);
    // DOCT, fechas y transacción electrónica van en sus propias columnas, no en el concepto.
    expect(s.movements[0]).toMatchObject({
      document: "TRETN",
      applicationDate: "10/02/2026",
      operationDate: "11/02/2026",
      electronicTransfer: "NO PAQ.-0004995138-0034254764",
      creditCents: 33720800000,
      debitCents: 0,
    });
    expect(s).toMatchObject({ accountNumber: "431-00102-2", periodFrom: "2026/02/01", periodTo: "2026/02/28" });
  });

  it("un concepto con nombre de crédito en la columna DEBITOS es débito", () => {
    const s = parseCoopcentralStatement(single([OPEN, ["NC TRAN ELEC INTERNA", "TRETN", "0.00", "500.00", "500.00"], close("500.00")]));
    expect(s.movements[0].transactionType).toBe("debit");
  });

  it("caso 5: importes con centavos sin errores de redondeo", () => {
    const s = parseCoopcentralStatement(single(rows));
    expect(s.movements.find((m) => m.concept === "RETEFUENTE")!.debitCents).toBe(480795);
    expect(s.movements.find((m) => m.concept === "INTERESES PAGADOS")!.creditCents).toBe(6868500);
  });

  it("casos 6 y 7: SALDO INICIAL y SALDO FINAL no son movimientos, pero aportan los saldos", () => {
    const s = parseCoopcentralStatement(single(rows));
    expect(s.movements.some((m) => /SALDO/.test(m.concept))).toBe(false);
    expect(s.openingBalanceCents).toBe(100000);
    expect(s.closingBalanceCents).toBe(-2712295);
  });

  it("caso 8 y 9: varias páginas, encabezados repetidos no son movimientos y el texto puede venir por columnas", () => {
    const p1 = page(1, [...header(), ...tableItems(rows.slice(0, 3))]);
    const p2 = page(2, [...header(), ...tableItems(rows.slice(3), { byColumns: true })]);
    const s = parseCoopcentralStatement(doc(p1, p2));
    expect(s.movements).toHaveLength(4);
    expect(s.movementsByPage).toEqual({ 1: 2, 2: 2 });
    expect(s.movements.map((m) => m.page)).toEqual([1, 1, 2, 2]);
    expect(s.issues).toEqual([]);
  });

  it("caso 10: concilia saldo inicial + créditos − débitos = saldo final", () => {
    const { validation, summary } = analyzeCoopcentral(single(rows));
    expect(summary.netCents).toBe(summary.totalCreditsCents - summary.totalDebitsCents);
    expect(validation.checks.find((c) => c.id === "reconciliation")!.status).toBe("ok");
    expect(validation.checks.find((c) => c.id === "balances")!.status).toBe("ok");
    expect(validation.validated).toBe(true);
  });

  it("si no concilia, advierte y no marca el análisis como validado (sin tocar los datos)", () => {
    const { validation, statement } = analyzeCoopcentral(single([...rows.slice(0, -1), close("1.00")]));
    const check = validation.checks.find((c) => c.id === "reconciliation")!;
    expect(check.status).toBe("failed");
    expect(check.detail).toContain(RECONCILIATION_WARNING);
    expect(validation.validated).toBe(false);
    expect(statement.movements).toHaveLength(4);
  });

  it("detecta una fila omitida por la secuencia de saldos", () => {
    const { validation } = analyzeCoopcentral(single([OPEN, ["TDB-POS", "1", "0.00", "100.00", "500.00"], close("500.00")]));
    expect(validation.checks.find((c) => c.id === "balances")!.status).toBe("failed");
    expect(validation.validated).toBe(false);
  });

  it("caso 11: una fila con crédito y débito a la vez es una anomalía, no un movimiento", () => {
    const { statement, validation } = analyzeCoopcentral(
      single([OPEN, ["AJUSTE RARO", "X", "100.00", "30.00", "1,070.00"], ["TDB-POS", "1", "0.00", "70.00", "1,000.00"], close("1,000.00")]),
    );
    expect(statement.anomalies).toHaveLength(1);
    expect(statement.anomalies[0]).toMatchObject({ concept: "AJUSTE RARO", creditCents: 10000, debitCents: 3000 });
    expect(statement.movements.map((m) => m.concept)).toEqual(["TDB-POS"]);
    expect(validation.checks.find((c) => c.id === "anomalies")!.status).toBe("failed");
    // La secuencia de saldos sí incluye la fila anómala.
    expect(validation.checks.find((c) => c.id === "balances")!.status).toBe("ok");
    expect(validation.validated).toBe(false);
  });

  it("una fila 0/0 que no es de saldo se reporta y no se convierte en movimiento", () => {
    const s = parseCoopcentralStatement(single([OPEN, ["TDB-POS", "1", "0.00", "0.00", "1,000.00"], ["TDB-POS", "2", "0.00", "1.00", "999.00"], close("999.00")]));
    expect(s.movements).toHaveLength(1);
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0].reason).toMatch(/ni en DEBITOS/);
  });

  it("une un concepto partido en dos líneas y conserva el texto exacto", () => {
    const items = [...header(), ...tableItems([OPEN, ["NC TRAN ELEC", "TRETN", "5.00", "0.00", "1,005.00"]]), mono("INTERNA", 47, 570 - 2 * 7), ...tableItems([close("1,005.00")], { startY: 570 - 3 * 7 })];
    const s = parseCoopcentralStatement(doc(page(1, items)));
    expect(s.movements[0].concept).toBe("NC TRAN ELEC INTERNA");
    expect(s.joinedLines).toBe(1);
  });

  it("el bloque TOTALES DEL PERIODO no genera movimientos y se usa solo para validar", () => {
    const totals: [string, string][] = [
      ["Consignaciones", "0.00"],
      ["Retiros", "337,300,000.00"],
      ["Notas Débito", "0.00"],
      ["Notas Crédito", "337,208,000.00"],
      ["Saldo en Canje", "0.00"],
      ["Intereses Recibidos", "68,685.00"],
      ["Retención", "4,807.95"],
      ["GMF", "0.00"],
    ];
    const { statement, validation } = analyzeCoopcentral(single(rows, totals));
    expect(statement.movements).toHaveLength(4);
    expect(statement.periodTotals).toMatchObject({ retirosCents: 33730000000, notasCreditoCents: 33720800000, retencionCents: 480795, interesesRecibidosCents: 6868500 });
    expect(validation.checks.filter((c) => c.id.startsWith("period-")).map((c) => c.status)).toEqual(["ok", "ok"]);
  });

  it("rechaza un PDF que no es de Coopcentral", () => {
    const other: PdfDocumentText = doc({ pageNumber: 1, width: 612, height: 792, items: [mono("BANCOLOMBIA", 10, 10)] });
    expect(() => parseCoopcentralStatement(other)).toThrow(new StatementError(COOPCENTRAL_MESSAGES.format));
  });

  it("sin columnas CREDITOS y DEBITOS informa el error", () => {
    const items = header().filter((i) => i.text !== "CREDITOS" && i.text !== "DEBITOS");
    expect(() => parseCoopcentralStatement(doc(page(1, [...items, ...tableItems(rows)])))).toThrow(COOPCENTRAL_MESSAGES.noAmountColumns);
  });

  it("sin movimientos informa que no se encontraron", () => {
    expect(() => parseCoopcentralStatement(single([OPEN, close("1,000.00")]))).toThrow(COOPCENTRAL_MESSAGES.noMovements);
  });
});

describe("saldos negativos con el signo separado del número", () => {
  const OPEN_REAL: Row = ["SALDO INICIAL", "INIC.", "0.00", "0.00", "399,702,290.00"];
  const PAQ = "NO PAQ.-0000000000-0000000000";

  it("parseCoopcentralMoney acepta signo pegado, separado o Unicode y rechaza un '-' aislado", () => {
    expect(parseCoopcentralMoney("0.00")).toBe(0);
    expect(parseCoopcentralMoney("2,380.00")).toBe(238000);
    expect(parseCoopcentralMoney("500,000,000.00")).toBe(50000000000);
    expect(parseCoopcentralMoney("-211,048,700.00")).toBe(-21104870000);
    expect(parseCoopcentralMoney("- 211,048,700.00")).toBe(-21104870000);
    expect(parseCoopcentralMoney("\u2212 211,048,700.00")).toBe(-21104870000);
    expect(parseCoopcentralMoney("\u2212211,048,700.00")).toBe(-21104870000);
    expect(parseCoopcentralMoney("-")).toBeNull();
    expect(parseCoopcentralMoney("\u2212")).toBeNull();
    expect(parseCoopcentralMoney("PAQ.-0000000000-0000000000")).toBeNull();
  });

  it("saldo positivo: la primera fila después de SALDO INICIAL sigue funcionando", () => {
    const { statement, validation } = analyzeCoopcentral(single([OPEN_REAL, ["ND COMIS. NACIONAL", "TMONO", "0.00", "2,380.00", "399,699,910.00", PAQ], close("399,699,910.00")]));
    expect(statement.movements[0]).toMatchObject({ concept: "ND COMIS. NACIONAL", transactionType: "debit", debitCents: 238000, balanceCents: 39969991000, electronicTransfer: PAQ });
    expect(validation.validated).toBe(true);
  });

  it("cruce a saldo negativo, negativo continuo, crédito y débito con saldo negativo y regreso a positivo", () => {
    const rows: Row[] = [
      ["SALDO INICIAL", "INIC.", "0.00", "0.00", "288,951,300.00"],
      ["ND TRANSACC ELECTRON", "TRETN", "0.00", "500,000,000.00", "- 211,048,700.00"],
      ["ND TRANSACC ELECTRON", "TRETN", "0.00", "125,000,000.00", "- 336,048,700.00"],
      ["ND COMIS. NACIONAL", "TMONO", "0.00", "2,380.00", "- 336,051,080.00", PAQ],
      ["default description", "TMINK", "0.00", "4,273,000.00", "- 340,324,080.00", PAQ],
      ["NC TRAN ELEC INTERNA", "TRETN", "200,000,000.00", "0.00", "- 140,324,080.00", "NO PAQ.-0005313761-0037540047"],
      ["TDB-POS", "97539", "0.00", "21,000,000.00", "- 161,324,080.00"],
      ["NC TRAN ELEC INTERNA", "TRETN", "200,000,000.00", "0.00", "38,675,920.00", "NO PAQ.-0005314352-0037556068"],
      close("38,675,920.00"),
    ];
    const { statement, validation } = analyzeCoopcentral(single(rows));
    expect(statement.issues).toEqual([]);
    expect(statement.movements.map((m) => [m.concept, m.transactionType, m.amountCents, m.balanceCents])).toEqual([
      ["ND TRANSACC ELECTRON", "debit", 50000000000, -21104870000],
      ["ND TRANSACC ELECTRON", "debit", 12500000000, -33604870000],
      ["ND COMIS. NACIONAL", "debit", 238000, -33605108000],
      ["default description", "debit", 427300000, -34032408000],
      ["NC TRAN ELEC INTERNA", "credit", 20000000000, -14032408000],
      ["TDB-POS", "debit", 2100000000, -16132408000],
      ["NC TRAN ELEC INTERNA", "credit", 20000000000, 3867592000],
    ]);
    // El guion de PAQ.-…-… es texto de TRANS. ELECTRONICA, no un signo.
    expect(statement.movements[2].electronicTransfer).toBe(PAQ);
    expect(validation.checks.find((c) => c.id === "balances")!.status).toBe("ok");
    expect(validation.checks.find((c) => c.id === "reconciliation")!.status).toBe("ok");
    expect(validation.validated).toBe(true);
  });

  it("saldo final negativo en varias páginas: no se reinicia el saldo y el cierre es el de la última página", () => {
    const p1 = page(1, [...header(), ...tableItems([OPEN_REAL, ["ND TRANSACC ELECTRON", "TRETN", "0.00", "500,000,000.00", "- 100,297,710.00"]])]);
    const p2 = page(2, [...header(), ...tableItems([["TDB-POS", "1", "0.00", "1,000.00", "- 100,298,710.00"], close("- 100,298,710.00")])]);
    const { statement, validation } = analyzeCoopcentral(doc(p1, p2));
    expect(statement.closingBalanceCents).toBe(-10029871000);
    expect(statement.movementsByPage).toEqual({ 1: 1, 2: 1 });
    expect(validation.validated).toBe(true);
  });

  it("un signo pegado ('-211,048,700.00') o Unicode ('− 211,048,700.00') también se reconoce", () => {
    const rows: Row[] = [OPEN_REAL, ["TDB-POS", "1", "0.00", "610,751,000.00", "-211,048,710.00"], ["TDB-POS", "2", "0.00", "10.00", "\u2212 211,048,720.00"], close("-211,048,720.00")];
    const { statement, validation } = analyzeCoopcentral(single(rows));
    expect(statement.movements.map((m) => m.balanceCents)).toEqual([-21104871000, -21104872000]);
    expect(validation.validated).toBe(true);
  });

  it("un '-' sin importe a su derecha sigue siendo una fila sin interpretar", () => {
    const items = [...header(), ...tableItems([OPEN_REAL, ["TDB-POS", "1", "0.00", "10.00", "399,702,280.00"], close("399,702,280.00")])];
    items.push(mono("TDB-POS", 47, 570 - 3 * 7), mono("1", 130, 570 - 3 * 7), right("5.00", 510, 570 - 3 * 7), mono("-", 575, 570 - 3 * 7));
    const s = parseCoopcentralStatement(doc(page(1, items)));
    expect(s.issues.some((i) => i.reason === 'Valor no interpretable: "-".')).toBe(true);
  });

  it("las filas sin interpretar con la misma causa se agrupan en un solo mensaje", () => {
    const issues = Array.from({ length: 943 }, (_, i) => ({ page: 1 + (i % 24), text: `fila ${i}`, reason: 'Valor no interpretable: "-".' }));
    issues.push({ page: 3, text: "otra", reason: "La fila no tiene CONCEPTO." });
    expect(groupIssues(issues).map((g) => [g.count, g.reason, g.example.text])).toEqual([
      [943, 'Valor no interpretable: "-".', "fila 0"],
      [1, "La fila no tiene CONCEPTO.", "otra"],
    ]);
    expect(issuesTitle(944)).toBe("Se encontraron 944 filas que no pudieron interpretarse.");
  });
});

describe("exportación Coopcentral", () => {
  it("hoja Resumen por grupo y hoja Movimientos con Crédito y Débito separados", () => {
    const { statement, groups } = analyzeCoopcentral(single([OPEN, ["TDB-POS", "37564", "0.00", "10.50", "989.50"], close("989.50")]));
    const [resumen, detalle] = buildCoopcentralSheets(statement, groups);
    expect(resumen.columns.map((c) => c.header)).toEqual(["Concepto", "Tipo", "Cantidad", "Total"]);
    expect(resumen.rows).toEqual([["TDB-POS", "Débito", 1, 10.5]]);
    expect(detalle.columns.map((c) => c.header)).toEqual(["Concepto", "Tipo", "Crédito", "Débito", "Valor", "Documento", "Fecha Aplicación", "Fecha Operación", "Saldo", "Página"]);
    expect(detalle.rows[0]).toEqual(["TDB-POS", "Débito", 0, 10.5, 10.5, "37564", "10/02/2026", "11/02/2026", 989.5, 1]);
    expect(suggestedCoopcentralName(statement, "x.pdf")).toBe("Analisis_Coopcentral_1022_2026-02");
  });
});
