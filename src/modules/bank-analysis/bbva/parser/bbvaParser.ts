/**
 * Parser del «Extracto de Cuenta» de BBVA Colombia (PDF con texto real).
 *
 * Estructura del formato soportado (construida sobre 17 extractos reales de
 * 1 a 10 páginas):
 * - Los títulos de la tabla (Movimiento, Fecha operación, Fecha valor,
 *   Concepto, Cargos, Abonos, Saldo) y las etiquetas «Número de cuenta» y
 *   «Fecha de corte» son parte del dibujo de la plantilla, NO texto: no hay
 *   encabezado que leer ni que pueda confundirse con un movimiento. Las
 *   columnas de valor se reconocen por las líneas verticales de la plantilla
 *   (página carta de 612 pt): Concepto | 380 | Cargos | 448 | Abonos | 518 |
 *   Saldo. Los valores van alineados a la derecha, así que cada uno se
 *   asigna por su borde derecho.
 * - Cada movimiento ocupa una sola línea y cada celda llega como un
 *   fragmento propio: [número] · fecha operación · fecha valor · concepto ·
 *   un valor en Cargos o en Abonos · saldo. La columna vacía no trae nada
 *   (ni «0.00» ni guion). Las últimas filas del extracto (intereses,
 *   retefuente) no traen número de movimiento.
 * - Fechas "01-08-2026". Importes "20,476,732.00" (coma de miles, punto
 *   decimal).
 * - La primera página trae la oficina, el número de cuenta, la fecha de
 *   corte, el periodo («PERÍODO DESDE: 01-08-2026 HASTA: 31-08-2026») y el
 *   «Resumen de movimientos» (SALDO CIERRE MES ANTERIOR, + ABONOS,
 *   + INTERESES RECIBIDOS, - CARGOS, - IVA, - 4 POR MIL, - RETENCIONES,
 *   SALDO FINAL), cada línea con su cantidad (No.) y su valor. Las demás
 *   páginas repiten «NÚMERO DE CUENTA: …  NOMBRE DEL CLIENTE: …» y siguen
 *   con la tabla. Al pie solo queda «Página N de M».
 *
 * El tipo (cargo o abono) lo decide únicamente la columna que trae el valor,
 * nunca el texto del concepto.
 */
import { normalizeKey } from "../../../../utils/text";
import { normalizeDescription } from "../../shared/groupingService";
import { parseStatementAmount } from "../../shared/money";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../shared/pdf/pdfTypes";
import { StatementError, type ParseIssue } from "../../shared/types";
import type { BbvaAnomaly, BbvaMovement, BbvaStatement, BbvaSummaryLine, BbvaTotals } from "../types";

export const BBVA_MESSAGES = {
  format: "El PDF no coincide con el formato de extracto BBVA soportado.",
  noMovements: "No se encontraron movimientos en el archivo.",
} as const;

const DATE = /^\d{2}-\d{2}-\d{4}$/;
const FOOTER = /^P[áa]gina\s+\d+\s+de\s+\d+$/i;

/** Líneas verticales de la plantilla, en puntos de una página de 612 pt de ancho. */
const TEMPLATE_WIDTH = 612;
const LINES = { amounts: 380, credits: 448, balance: 518 };

/** "01-08-2026" → "2026/08/01". */
const toIso = (date: string) => date.split("-").reverse().join("/");

// ---------------------------------------------------------------------------
// Filas visuales
// ---------------------------------------------------------------------------

interface Cell {
  text: string;
  x: number;
  right: number;
}

interface Row {
  y: number;
  cells: Cell[];
  text: string;
}

/** Agrupa los fragmentos por línea base, de arriba hacia abajo. */
function buildRows(items: PdfTextItem[]): Row[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: { y: number; height: number; items: PdfTextItem[] }[] = [];
  for (const item of sorted) {
    const g = groups[groups.length - 1];
    const tolerance = Math.max(1.5, 0.35 * Math.max(item.height, g?.height ?? 0));
    if (g && Math.abs(g.y - item.y) <= tolerance) g.items.push(item);
    else groups.push({ y: item.y, height: item.height, items: [item] });
  }
  return groups.map((g) => {
    const cells = g.items
      .map((i) => ({ text: i.text.replace(/\s+/g, " ").trim(), x: i.x, right: i.x + i.width }))
      .filter((c) => c.text)
      .sort((a, b) => a.x - b.x);
    return { y: g.y, cells, text: cells.map((c) => c.text).join(" ") };
  });
}

// ---------------------------------------------------------------------------
// Resumen de movimientos (primera página)
// ---------------------------------------------------------------------------

type BalanceField = "openingBalanceCents" | "closingBalanceCents";
type LineField = Exclude<keyof BbvaTotals, BalanceField>;

const SUMMARY_LABELS: Record<string, BalanceField | LineField> = {
  "saldo cierre mes anterior": "openingBalanceCents",
  abonos: "credits",
  "intereses recibidos": "interest",
  cargos: "charges",
  iva: "vat",
  "4 por mil": "fourPerThousand",
  retenciones: "withholdings",
  "saldo final": "closingBalanceCents",
};

/** "+ ABONOS" → "abonos"; "- 4 POR MIL" → "4 por mil". */
const summaryField = (text: string) => SUMMARY_LABELS[normalizeKey(text).replace(/^[+-]\s*/, "")];

/** Lee «etiqueta · [cantidad] · valor» de una fila del resumen (cada fila trae dos etiquetas). */
function readSummaryRow(row: Row, totals: BbvaTotals): void {
  let field: BalanceField | LineField | undefined;
  let count: number | undefined;
  for (const cell of row.cells) {
    const label = summaryField(cell.text);
    if (label) {
      field = label;
      count = undefined;
      continue;
    }
    if (!field) continue;
    if (/^\d+$/.test(cell.text)) {
      count = Number(cell.text);
      continue;
    }
    const cents = parseStatementAmount(cell.text);
    if (cents === null) continue;
    if (field === "openingBalanceCents" || field === "closingBalanceCents") totals[field] ??= cents;
    else totals[field] ??= { count, cents } satisfies BbvaSummaryLine;
    field = undefined;
  }
}

// ---------------------------------------------------------------------------
// Filas de la tabla
// ---------------------------------------------------------------------------

interface RawRow {
  page: number;
  row: number;
  y: number;
  movementNumber?: string;
  operationDate: string;
  valueDate: string;
  concept: string;
  /** undefined = columna vacía en el PDF. */
  chargeCents?: number;
  creditCents?: number;
  balanceCents?: number;
  text: string;
}

interface PageResult {
  rows: RawRow[];
  issues: ParseIssue[];
  /** Filas por encima de la tabla: datos de la cuenta y resumen. */
  headerRows: Row[];
}

type AmountColumn = "charge" | "credit" | "balance";

const COLUMN_NAME: Record<AmountColumn, string> = { charge: "Cargos", credit: "Abonos", balance: "Saldo" };

function parsePage(page: PdfPageText): PageResult {
  const scale = page.width / TEMPLATE_WIDTH;
  const lines = { amounts: LINES.amounts * scale, credits: LINES.credits * scale, balance: LINES.balance * scale };
  /** Columna por el borde derecho del valor (van alineados a la derecha). */
  const columnOf = (cell: Cell): AmountColumn => (cell.right <= lines.credits ? "charge" : cell.right <= lines.balance ? "credit" : "balance");
  /** Línea izquierda de cada columna: un valor que la cruza está corrido. */
  const leftLine: Record<AmountColumn, number> = { charge: lines.amounts, credit: lines.credits, balance: lines.balance };

  const result: PageResult = { rows: [], issues: [], headerRows: [] };
  let started = false;
  let rowNumber = 0;

  for (const row of buildRows(page.items)) {
    const issue = (reason: string) => result.issues.push({ page: page.pageNumber, text: row.text, reason });
    const dates = row.cells.filter((c) => DATE.test(c.text) && c.x < lines.amounts);

    if (dates.length < 2) {
      // Antes de la primera fila con fechas: datos de la cuenta y resumen. Después, la
      // tabla solo debería traer movimientos (y el número de página al pie).
      if (!started) result.headerRows.push(row);
      else if (!FOOTER.test(row.text)) issue("Fila dentro de la tabla sin Fecha operación y Fecha valor; no se sumó ni se unió a ningún movimiento.");
      continue;
    }

    started = true;
    rowNumber += 1;
    const [operation, value] = dates;
    const before = row.cells.filter((c) => c.x < operation.x);
    const after = row.cells.filter((c) => c !== operation && c !== value && c.x > operation.x);
    const conceptCells = after.filter((c) => c.x < lines.amounts);
    const amountCells = after.filter((c) => c.x >= lines.amounts);

    if (before.length > 1 || (before.length === 1 && !/^\d+$/.test(before[0].text))) {
      issue("La columna Movimiento trae un contenido que no es un número.");
      continue;
    }

    const amounts: Partial<Record<AmountColumn, number>> = {};
    let failed = false;
    for (const cell of amountCells) {
      const column = columnOf(cell);
      const cents = parseStatementAmount(cell.text);
      if (cents === null) {
        issue(`Valor no interpretable en ${COLUMN_NAME[column]}: "${cell.text}".`);
        failed = true;
      } else if (cell.x < leftLine[column] - 2 * scale) {
        issue(`El valor "${cell.text}" ocupa más de una columna; no se pudo asignar a Cargos, Abonos o Saldo.`);
        failed = true;
      } else if (amounts[column] !== undefined) {
        issue(`La columna ${COLUMN_NAME[column]} trae más de un valor.`);
        failed = true;
      } else if (column !== "balance" && cents < 0) {
        issue(`Valor negativo en ${COLUMN_NAME[column]}: "${cell.text}".`);
        failed = true;
      } else {
        amounts[column] = cents;
      }
      if (failed) break;
    }
    if (failed) continue;

    const concept = normalizeDescription(conceptCells.map((c) => c.text).join(" "));
    if (!concept) {
      issue("La fila no tiene Concepto.");
      continue;
    }
    if (amounts.charge === undefined && amounts.credit === undefined) {
      issue("La fila no tiene valor en Cargos ni en Abonos; no se sumó.");
      continue;
    }
    if (amounts.charge === 0 && amounts.credit === 0) {
      issue("La fila trae 0.00 en Cargos y en Abonos; no se clasificó.");
      continue;
    }

    result.rows.push({
      page: page.pageNumber,
      row: rowNumber,
      y: row.y,
      movementNumber: before[0]?.text,
      operationDate: operation.text,
      valueDate: value.text,
      concept,
      chargeCents: amounts.charge,
      creditCents: amounts.credit,
      balanceCents: amounts.balance,
      text: row.text,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Datos de la cuenta
// ---------------------------------------------------------------------------

type AccountInfo = Pick<BbvaStatement, "accountNumber" | "clientName" | "periodFrom" | "periodTo" | "cutoffDate">;

/** Las líneas del bloque de dirección terminan en " ." («KAES S.A.S .»): se quita ese cierre. */
const cleanName = (text: string) => text.replace(/\s*\.$/, "").trim() || undefined;

function readAccountInfo(headers: { page: number; rows: Row[] }[]): AccountInfo {
  const info: AccountInfo = {};
  for (const { rows } of headers) {
    for (const row of rows) {
      const period = /PER[IÍ]ODO\s+DESDE:?\s*(\d{2}-\d{2}-\d{4})\s+HASTA:?\s*(\d{2}-\d{2}-\d{4})/i.exec(row.text);
      if (!info.periodFrom && period) {
        info.periodFrom = toIso(period[1]);
        info.periodTo = toIso(period[2]);
      }
      const account = /N[UÚ]MERO\s+DE\s+CUENTA:?\s*(\d{6,})/i.exec(row.text);
      if (!info.accountNumber && account) info.accountNumber = account[1];
      const client = /NOMBRE\s+DEL\s+CLIENTE:?\s*(.+)$/i.exec(row.text);
      if (!info.clientName && client) info.clientName = cleanName(client[1]);
    }
  }
  // Primera página: la etiqueta es parte del dibujo, solo llega el valor.
  const first = headers.find((h) => h.page === 1)?.rows ?? [];
  info.accountNumber ??= first.flatMap((r) => r.cells).find((c) => /^\d{14,20}$/.test(c.text))?.text;
  const cutoff = first.find((r) => r.cells.length === 1 && DATE.test(r.cells[0].text));
  if (cutoff) info.cutoffDate = toIso(cutoff.cells[0].text);
  // El nombre encabeza el bloque de dirección, que es lo primero de la página.
  if (!info.clientName && first.length > 0) info.clientName = cleanName(first[0].text);
  return info;
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

export function parseBbvaStatement(doc: PdfDocumentText): BbvaStatement {
  const allText = normalizeKey(doc.pages.flatMap((p) => p.items.map((i) => i.text)).join(" "));
  if (!allText.includes("saldo cierre mes anterior") || !allText.includes("4 por mil") || !allText.includes("periodo desde")) {
    throw new StatementError(BBVA_MESSAGES.format);
  }

  const raws: RawRow[] = [];
  const issues: ParseIssue[] = [];
  const movementsByPage: Record<number, number> = {};
  const headers: { page: number; rows: Row[] }[] = [];
  const totals: BbvaTotals = {};

  for (const page of doc.pages) {
    const result = parsePage(page);
    headers.push({ page: page.pageNumber, rows: result.headerRows });
    for (const row of result.headerRows) readSummaryRow(row, totals);
    issues.push(...result.issues);
    if (result.rows.length > 0) movementsByPage[page.pageNumber] = result.rows.length;
    raws.push(...result.rows);
  }
  if (raws.length === 0 && issues.length === 0) throw new StatementError(BBVA_MESSAGES.noMovements);

  const movements: BbvaMovement[] = [];
  const anomalies: BbvaAnomaly[] = [];
  raws.forEach((r, index) => {
    const chargeCents = r.chargeCents ?? 0;
    const creditCents = r.creditCents ?? 0;
    const common = { index, movementNumber: r.movementNumber, operationDate: r.operationDate, valueDate: r.valueDate, concept: r.concept, chargeCents, creditCents, balanceCents: r.balanceCents, page: r.page, row: r.row, y: r.y };
    if (chargeCents > 0 && creditCents > 0) {
      anomalies.push({ ...common, text: r.text });
      return;
    }
    // La columna que trae el valor decide el tipo (también cuando el valor es 0.00, como «APERTURA DE CUENTA»).
    const credit = creditCents > 0 || (chargeCents === 0 && r.creditCents !== undefined);
    movements.push({ ...common, transactionType: credit ? "credit" : "debit", amountCents: credit ? creditCents : chargeCents });
  });

  return { bank: "BBVA", ...readAccountInfo(headers), pageCount: doc.pageCount, movementsByPage, movements, anomalies, issues, totals };
}
