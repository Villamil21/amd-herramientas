/**
 * Parser del «Extracto de Cuenta» de Bancoomeva (PDF con texto real).
 *
 * Estructura del formato soportado (construida sobre un extracto real de 7
 * páginas):
 * - La primera página trae NOMBRE, CUENTA No, NIT, CIUDAD y el periodo
 *   («DEL: 01-06-2026  AL: 30-06-2026»).
 * - Cada página repite el encabezado FECHA | OFICINA | DESCRIPCION |
 *   VALOR DEBITO | VALOR CREDITO | SALDO. Todas las columnas están
 *   CENTRADAS bajo su título y cada celda llega como un fragmento propio
 *   («LABORATORIO - CORE», «N/DND TRANSACCIONES BRE-B MONO», «$ 8,880,000.00»).
 *   Por eso cada fragmento se asigna a la columna cuyo título tiene el
 *   centro más cercano: Oficina y Descripción nunca se mezclan.
 * - Fecha "04-06-2026". Importes "$ 28,400,000.00" (coma de miles, punto
 *   decimal); la columna sin valor trae "$ 0.00".
 * - Debajo de la tabla de CADA página se repite el bloque SALDO INICIAL |
 *   RENDIMIENTOS No | TOTAL DEBITO | TOTAL CREDITO | SALDO FINAL con los
 *   totales del extracto completo (no de la página): se leen en cada página
 *   solo para comprobar que coinciden, y se usan una sola vez. Ese bloque
 *   marca el fin de la tabla; después vienen textos legales y URLs.
 *
 * El tipo (crédito o débito) lo decide únicamente la columna que trae el
 * valor, nunca el texto de la descripción.
 */
import { normalizeKey } from "../../../../utils/text";
import { normalizeDescription } from "../../shared/groupingService";
import { parseStatementAmount } from "../../shared/money";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../shared/pdf/pdfTypes";
import { splitWords, type Word } from "../../shared/pdf/rows";
import { StatementError, type ParseIssue } from "../../shared/types";
import type { BancoomevaAnomaly, BancoomevaMovement, BancoomevaStatement, BancoomevaTotals } from "../types";

export const BANCOOMEVA_MESSAGES = {
  format: "El PDF no coincide con el formato de extracto Bancoomeva soportado.",
  noMovements: "No se encontraron movimientos en el archivo.",
} as const;

const DATE = /^(\d{2})-(\d{2})-(\d{4})$/;

/** "$ 28,400,000.00" → 2840000000 centavos. null si no es un importe exacto. */
export function parseBancoomevaAmount(text: string): number | null {
  const m = /^(-)?\s*\$?\s*(-)?\s*(\S+)$/.exec(text.trim());
  if (!m) return null;
  const cents = parseStatementAmount(m[3]);
  if (cents === null || cents < 0) return null;
  return (m[1] || m[2]) && cents !== 0 ? -cents : cents;
}

// ---------------------------------------------------------------------------
// Filas visuales
// ---------------------------------------------------------------------------

interface Cell {
  text: string;
  x: number;
  right: number;
  center: number;
  height: number;
}

interface Row {
  y: number;
  cells: Cell[];
  words: Word[];
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
      .map((i) => ({ text: i.text.replace(/\s+/g, " ").trim(), x: i.x, right: i.x + i.width, center: i.x + i.width / 2, height: i.height }))
      .filter((c) => c.text)
      .sort((a, b) => a.x - b.x);
    const words = g.items.flatMap(splitWords).sort((a, b) => a.x - b.x);
    return { y: g.y, cells, words, text: cells.map((c) => c.text).join(" ") };
  });
}

/** Posición de una frase (ej. "valor debito") formada por palabras consecutivas de la fila. */
function findPhrase(words: Word[], phrase: string): { x: number; right: number; center: number } | undefined {
  const keys = words.map((w) => normalizeKey(w.text).replace(/[.:]+$/, ""));
  const parts = phrase.split(" ");
  for (let i = 0; i + parts.length <= keys.length; i++) {
    if (parts.every((p, j) => keys[i + j] === p)) {
      const x = words[i].x;
      const right = words[i + parts.length - 1].right;
      return { x, right, center: (x + right) / 2 };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Encabezado de la tabla
// ---------------------------------------------------------------------------

type Column = "date" | "office" | "description" | "debit" | "credit" | "balance";

const HEADER: [Column, string][] = [
  ["date", "fecha"],
  ["office", "oficina"],
  ["description", "descripcion"],
  ["debit", "valor debito"],
  ["credit", "valor credito"],
  ["balance", "saldo"],
];

type Header = Record<Column, number>;

/** Centros de los seis títulos, en su orden de izquierda a derecha; undefined si la fila no es el encabezado. */
function readHeader(row: Row): Header | undefined {
  const header = {} as Header;
  for (const [column, phrase] of HEADER) {
    const found = findPhrase(row.words, phrase);
    if (!found) return undefined;
    header[column] = found.center;
  }
  const centers = HEADER.map(([c]) => header[c]);
  return centers.every((c, i) => i === 0 || centers[i - 1] < c) ? header : undefined;
}

/** Columna cuyo título tiene el centro más cercano al fragmento (las columnas van centradas). */
function columnOf(cell: Cell, header: Header): Column {
  let best: Column = "date";
  for (const [column] of HEADER) if (Math.abs(header[column] - cell.center) < Math.abs(header[best] - cell.center)) best = column;
  return best;
}

// ---------------------------------------------------------------------------
// Bloque de totales (repetido al pie de cada página)
// ---------------------------------------------------------------------------

const TOTAL_LABELS: [keyof BancoomevaTotals | null, string][] = [
  ["openingBalanceCents", "saldo inicial"],
  [null, "rendimientos no"],
  ["totalDebitsCents", "total debito"],
  ["totalCreditsCents", "total credito"],
  ["closingBalanceCents", "saldo final"],
];

const isTotalsLabelRow = (row: Row) => findPhrase(row.words, "total debito") !== undefined && findPhrase(row.words, "total credito") !== undefined;

/** Lee los importes que están debajo de cada etiqueta del bloque de totales. */
function readTotals(rows: Row[], labelIndex: number): BancoomevaTotals {
  const labels = TOTAL_LABELS.map(([field, phrase]) => ({ field, pos: findPhrase(rows[labelIndex].words, phrase) })).filter((l) => l.pos);
  const totals: BancoomevaTotals = {};
  const limit = rows[labelIndex].y - 3 * Math.max(...rows[labelIndex].cells.map((c) => c.height));
  for (let i = labelIndex + 1; i < rows.length && rows[i].y >= limit; i++) {
    for (const cell of rows[i].cells) {
      const cents = parseBancoomevaAmount(cell.text);
      if (cents === null) continue;
      let nearest = labels[0];
      for (const l of labels) if (Math.abs(l.pos!.center - cell.center) < Math.abs(nearest.pos!.center - cell.center)) nearest = l;
      if (nearest?.field && totals[nearest.field] === undefined) totals[nearest.field] = cents;
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Filas de la tabla
// ---------------------------------------------------------------------------

interface RawRow {
  page: number;
  y: number;
  height: number;
  date: string;
  office: string[];
  description: string[];
  debitCents: number;
  creditCents: number;
  balanceCents?: number;
  text: string;
}

interface PageResult {
  hasTable: boolean;
  rows: RawRow[];
  issues: ParseIssue[];
  joinedLines: number;
  totals?: BancoomevaTotals;
  allRows: Row[];
}

function parsePage(page: PdfPageText): PageResult {
  const rows = buildRows(page.items);
  const totalsIndex = rows.findIndex(isTotalsLabelRow);
  const totals = totalsIndex >= 0 ? readTotals(rows, totalsIndex) : undefined;
  let headerIndex = -1;
  let header: Header | undefined;
  for (let i = 0; i < rows.length && !header; i++) {
    header = readHeader(rows[i]);
    if (header) headerIndex = i;
  }
  if (!header) return { hasTable: false, rows: [], issues: [], joinedLines: 0, totals, allRows: rows };

  const result: PageResult = { hasTable: true, rows: [], issues: [], joinedLines: 0, totals, allRows: rows };
  const end = totalsIndex > headerIndex ? totalsIndex : rows.length;
  let last: RawRow | undefined;
  let lastY = Infinity;

  for (let i = headerIndex + 1; i < end; i++) {
    const row = rows[i];
    const byColumn = new Map<Column, Cell[]>();
    for (const cell of row.cells) {
      const column = columnOf(cell, header);
      byColumn.set(column, [...(byColumn.get(column) ?? []), cell]);
    }
    const text = (column: Column) => byColumn.get(column)?.map((c) => c.text).join(" ");
    const hasMoney = (["debit", "credit", "balance"] as Column[]).some((c) => byColumn.has(c));
    const date = text("date");
    const height = Math.max(...row.cells.map((c) => c.height));

    if (date === undefined) {
      // Continuación de Oficina o Descripción (celda de varias líneas): solo texto,
      // justo debajo del último movimiento y con la misma letra.
      if (!hasMoney && last && lastY - row.y <= 1.8 * last.height && Math.abs(height - last.height) <= 0.5) {
        const office = text("office");
        const description = text("description");
        if (office) last.office.push(office);
        if (description) last.description.push(description);
        result.joinedLines += 1;
        lastY = row.y;
      } else if (hasMoney) {
        result.issues.push({ page: page.pageNumber, text: row.text, reason: "La fila tiene valores pero no tiene fecha." });
      }
      continue;
    }

    const issue = (reason: string) => result.issues.push({ page: page.pageNumber, text: row.text, reason });
    if (!DATE.test(date)) {
      if (hasMoney) issue(`Fecha no válida: "${date}".`);
      continue;
    }
    const debitText = text("debit");
    const creditText = text("credit");
    const balanceText = text("balance");
    if (debitText === undefined || creditText === undefined) {
      issue("La fila no trae VALOR DEBITO y VALOR CREDITO.");
      continue;
    }
    const debit = parseBancoomevaAmount(debitText);
    const credit = parseBancoomevaAmount(creditText);
    const balance = balanceText === undefined ? undefined : parseBancoomevaAmount(balanceText);
    if (debit === null || debit < 0) {
      issue(`Valor débito no interpretable: "${debitText}".`);
      continue;
    }
    if (credit === null || credit < 0) {
      issue(`Valor crédito no interpretable: "${creditText}".`);
      continue;
    }
    if (balance === null) {
      issue(`Saldo no interpretable: "${balanceText}".`);
      continue;
    }
    if (debit === 0 && credit === 0) {
      issue("La fila no tiene valor en débito ni en crédito.");
      continue;
    }
    last = {
      page: page.pageNumber,
      y: row.y,
      height,
      date,
      office: text("office") ? [text("office")!] : [],
      description: text("description") ? [text("description")!] : [],
      debitCents: debit,
      creditCents: credit,
      balanceCents: balance,
      text: row.text,
    };
    lastY = row.y;
    result.rows.push(last);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Datos de la cuenta
// ---------------------------------------------------------------------------

function readAccountInfo(rows: Row[]): Pick<BancoomevaStatement, "accountNumber" | "periodFrom" | "periodTo"> {
  const info: Pick<BancoomevaStatement, "accountNumber" | "periodFrom" | "periodTo"> = {};
  const toIso = (d: string) => d.split("-").reverse().join("/");
  for (const row of rows) {
    const account = /CUENTA\s+No\.?:?\s*(\d{6,})/i.exec(row.text);
    if (!info.accountNumber && account) info.accountNumber = account[1];
    const period = /DEL:?\s*(\d{2}-\d{2}-\d{4})\s+AL:?\s*(\d{2}-\d{2}-\d{4})/i.exec(row.text);
    if (!info.periodFrom && period) {
      info.periodFrom = toIso(period[1]);
      info.periodTo = toIso(period[2]);
    }
  }
  return info;
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

export function parseBancoomevaStatement(doc: PdfDocumentText): BancoomevaStatement {
  const allText = normalizeKey(doc.pages.flatMap((p) => p.items.map((i) => i.text)).join(" "));
  if (!allText.includes("bancoomeva")) throw new StatementError(BANCOOMEVA_MESSAGES.format);

  const raws: RawRow[] = [];
  const issues: ParseIssue[] = [];
  const movementsByPage: Record<number, number> = {};
  const pageTotals: { page: number; totals: BancoomevaTotals }[] = [];
  const allRows: Row[] = [];
  let joinedLines = 0;
  let tables = 0;

  for (const page of doc.pages) {
    const result = parsePage(page);
    allRows.push(...result.allRows);
    if (result.totals) pageTotals.push({ page: page.pageNumber, totals: result.totals });
    if (!result.hasTable) continue;
    tables += 1;
    movementsByPage[page.pageNumber] = result.rows.length;
    raws.push(...result.rows);
    issues.push(...result.issues);
    joinedLines += result.joinedLines;
  }
  if (tables === 0) throw new StatementError(BANCOOMEVA_MESSAGES.format);
  if (raws.length === 0) throw new StatementError(BANCOOMEVA_MESSAGES.noMovements);

  // Totales del extracto: se toman una sola vez; si otra página trae valores distintos, se informa.
  const totals: BancoomevaTotals = {};
  const totalsMismatchPages: number[] = [];
  for (const { page, totals: t } of pageTotals) {
    let differs = false;
    for (const key of Object.keys(t) as (keyof BancoomevaTotals)[]) {
      if (totals[key] === undefined) totals[key] = t[key];
      else if (totals[key] !== t[key]) differs = true;
    }
    if (differs) totalsMismatchPages.push(page);
  }

  const movements: BancoomevaMovement[] = [];
  const anomalies: BancoomevaAnomaly[] = [];
  raws.forEach((r, index) => {
    const description = normalizeDescription(r.description.join(" "));
    const office = normalizeDescription(r.office.join(" ")) || undefined;
    if (r.debitCents > 0 && r.creditCents > 0) {
      anomalies.push({ index, page: r.page, y: r.y, date: r.date, description, debitCents: r.debitCents, creditCents: r.creditCents, balanceCents: r.balanceCents, text: r.text });
      return;
    }
    if (!description) {
      issues.push({ page: r.page, text: r.text, reason: "La fila no tiene Descripción." });
      return;
    }
    const credit = r.creditCents > 0;
    movements.push({
      index,
      date: r.date,
      office,
      description,
      debitCents: r.debitCents,
      creditCents: r.creditCents,
      transactionType: credit ? "credit" : "debit",
      amountCents: credit ? r.creditCents : r.debitCents,
      balanceCents: r.balanceCents,
      page: r.page,
      y: r.y,
    });
  });

  return {
    bank: "Bancoomeva",
    ...readAccountInfo(allRows),
    pageCount: doc.pageCount,
    movementsByPage,
    movements,
    anomalies,
    issues,
    totals,
    totalsMismatchPages,
    joinedLines,
  };
}
