/**
 * Parser del extracto de cuenta de Bancolombia (PDF con texto real).
 *
 * Estructura del formato soportado (construida sobre un extracto real):
 * - Cada página repite los datos de la cuenta y el encabezado de la tabla
 *   FECHA | DESCRIPCIÓN | SUCURSAL | DCTO. | VALOR | SALDO.
 * - La primera página trae además el bloque RESUMEN (SALDO ANTERIOR,
 *   TOTAL ABONOS, TOTAL CARGOS, SALDO ACTUAL) encima de la tabla.
 * - La tabla termina con la fila "FIN ESTADO DE CUENTA".
 * - Los importes usan coma de miles y punto decimal: 3,791,445.00 · -126,530.60 · .00
 * - Las líneas de la tabla son una imagen: no hay trazos que marquen las
 *   columnas, y el texto puede venir fila por fila o columna por columna.
 *
 * Por eso las filas se reconstruyen con coordenadas (rows.ts) y las columnas
 * se ubican con el encabezado de cada página: los títulos están centrados en
 * su columna y las columnas son contiguas, de modo que, conociendo dónde
 * empieza el texto de DESCRIPCIÓN, se deduce dónde terminan DESCRIPCIÓN,
 * SUCURSAL y DCTO. VALOR y SALDO (alineados a la derecha) se asignan al
 * título más cercano.
 */
import { normalizeKey } from "../../../../utils/text";
import { normalizeDescription } from "../../shared/groupingService";
import { isStatementAmount, parseStatementAmount, signOf } from "../../shared/money";
import type { PdfDocumentText, PdfPageText } from "../../shared/pdf/pdfTypes";
import { buildRows, center, joinWords, type TextRow, type Word } from "../../shared/pdf/rows";
import { StatementError, type BankMovement, type ParseIssue, type ParsedStatement, type StatementTotals } from "../../shared/types";

export const BANCOLOMBIA_MESSAGES = {
  format: "El PDF no coincide con el formato Bancolombia soportado.",
  noMovements: "No se encontraron movimientos en el archivo.",
  noValueColumn: "No fue posible identificar la columna VALOR.",
} as const;

const COLUMNS = ["fecha", "descripcion", "sucursal", "dcto", "valor", "saldo"] as const;
type Column = (typeof COLUMNS)[number];
type Centers = Record<Column, number>;

const DATE = /^(\d{1,2})\/(\d{1,2})$/;
const END_OF_STATEMENT = "fin estado de cuenta";

const TOTAL_LABELS: [keyof StatementTotals, string][] = [
  ["previousBalanceCents", "saldo anterior"],
  ["totalCreditsCents", "total abonos"],
  ["totalDebitsCents", "total cargos"],
  ["currentBalanceCents", "saldo actual"],
];

const wordKey = (w: Word) => normalizeKey(w.text).replace(/[.:]+$/, "");

function isDateText(text: string): boolean {
  const m = DATE.exec(text);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

// ---------------------------------------------------------------------------
// Encabezado y columnas
// ---------------------------------------------------------------------------

interface Header {
  rowIndex: number;
  centers: Centers;
  fechaRight: number;
}

/** Busca la fila de títulos de la tabla. null si la página no tiene tabla. */
function findHeader(rows: TextRow[]): Header | null {
  for (let i = 0; i < rows.length; i++) {
    const byKey = new Map<string, Word>();
    for (const w of rows[i].words) byKey.set(wordKey(w), w);
    if (!byKey.has("fecha") || !byKey.has("descripcion")) continue;
    if (!byKey.has("valor")) throw new StatementError(BANCOLOMBIA_MESSAGES.noValueColumn);
    if (COLUMNS.some((c) => !byKey.has(c))) throw new StatementError(BANCOLOMBIA_MESSAGES.format);
    const centers = Object.fromEntries(COLUMNS.map((c) => [c, center(byKey.get(c)!)])) as Centers;
    const ordered = COLUMNS.every((c, k) => k === 0 || centers[COLUMNS[k - 1]] < centers[c]);
    if (!ordered) throw new StatementError(BANCOLOMBIA_MESSAGES.format);
    return { rowIndex: i, centers, fechaRight: byKey.get("fecha")!.right };
  }
  return null;
}

interface Bounds {
  /** Límite derecho de DESCRIPCIÓN (inicio de SUCURSAL). */
  descEnd: number;
  sucEnd: number;
  /** Inicio de la zona de VALOR y SALDO. */
  amountsStart: number;
}

/**
 * Límites de las columnas de texto. Columnas contiguas con título centrado:
 * fin = 2·centro − inicio. El inicio de DESCRIPCIÓN se mide sobre las filas
 * de movimientos de la página.
 */
function columnBounds(rows: TextRow[], h: Header): Bounds {
  const c = h.centers;
  let descStart = Infinity;
  for (const row of rows) {
    const [first, second] = row.words;
    if (!first || !second || !isDateText(first.text) || center(first) >= c.descripcion) continue;
    const amounts = row.words.filter((w) => isStatementAmount(w.text) && center(w) > c.dcto);
    if (amounts.length >= 2 && !amounts.includes(second)) descStart = Math.min(descStart, second.x);
  }
  if (!Number.isFinite(descStart)) descStart = h.fechaRight;
  const descEnd = 2 * c.descripcion - descStart;
  const sucEnd = 2 * c.sucursal - descEnd;
  const amountsStart = 2 * c.dcto - sucEnd;
  return { descEnd, sucEnd, amountsStart };
}

// ---------------------------------------------------------------------------
// Filas de movimientos
// ---------------------------------------------------------------------------

interface RowDraft {
  page: number;
  y: number;
  date: string;
  description: string;
  valueCents: number;
  balanceCents?: number;
  branch?: string;
  document?: string;
}

type RowResult =
  | { kind: "end" }
  | { kind: "movement"; draft: RowDraft }
  | { kind: "continuation"; text: string }
  | { kind: "issue"; issue: ParseIssue }
  | { kind: "other" };

function classifyRow(row: TextRow, page: number, h: Header, b: Bounds): RowResult {
  const text = joinWords(row.words);
  if (normalizeKey(text) === END_OF_STATEMENT) return { kind: "end" };
  const c = h.centers;

  const [first] = row.words;
  const hasDate = isDateText(first.text) && center(first) < c.descripcion;
  const rest = hasDate ? row.words.slice(1) : row.words;
  const desc: Word[] = [];
  const branch: Word[] = [];
  const doc: Word[] = [];
  const valor: Word[] = [];
  const saldo: Word[] = [];
  const unreadable: Word[] = [];

  for (const w of rest) {
    const mid = center(w);
    if (mid >= b.amountsStart) {
      if (!isStatementAmount(w.text)) unreadable.push(w);
      else if (Math.abs(mid - c.valor) <= Math.abs(mid - c.saldo)) valor.push(w);
      else saldo.push(w);
    } else if (w.x < b.descEnd) desc.push(w);
    else if (mid < b.sucEnd) branch.push(w);
    else doc.push(w);
  }

  const hasAmounts = valor.length > 0 || saldo.length > 0;
  if (!hasDate && !hasAmounts) {
    // Solo texto en DESCRIPCIÓN: posible continuación de la descripción anterior.
    const onlyDescription = desc.length > 0 && branch.length + doc.length + unreadable.length === 0;
    return onlyDescription ? { kind: "continuation", text: joinWords(desc) } : { kind: "other" };
  }

  const reason = !hasDate
    ? "La fila no tiene una fecha válida."
    : desc.length === 0
      ? "La fila no tiene descripción."
      : unreadable.length > 0
        ? `Valor no interpretable: "${joinWords(unreadable)}".`
        : valor.length !== 1
          ? "No se pudo identificar el VALOR de la fila."
          : saldo.length > 1
            ? "No se pudo identificar el SALDO de la fila."
            : null;
  if (reason) return { kind: "issue", issue: { page, text, reason } };

  return {
    kind: "movement",
    draft: {
      page,
      y: row.y,
      date: first.text,
      description: normalizeDescription(joinWords(desc)),
      valueCents: parseStatementAmount(valor[0].text)!,
      balanceCents: saldo.length === 1 ? parseStatementAmount(saldo[0].text)! : undefined,
      branch: branch.length ? joinWords(branch) : undefined,
      document: doc.length ? joinWords(doc) : undefined,
    },
  };
}

interface PageResult {
  hasTable: boolean;
  drafts: RowDraft[];
  issues: ParseIssue[];
  joinedLines: number;
  ended: boolean;
  /** Filas encima del encabezado (datos de la cuenta, RESUMEN). */
  headerArea: TextRow[];
}

function parsePage(page: PdfPageText): PageResult {
  const rows = buildRows(page.items);
  const header = findHeader(rows);
  if (!header) return { hasTable: false, drafts: [], issues: [], joinedLines: 0, ended: false, headerArea: rows };

  const tableRows = rows.slice(header.rowIndex + 1);
  const bounds = columnBounds(tableRows, header);
  const drafts: RowDraft[] = [];
  const issues: ParseIssue[] = [];
  let joinedLines = 0;
  let ended = false;
  let previous: RowResult["kind"] | null = null;
  let previousY = 0;
  let pitch = Infinity; // distancia típica entre filas de movimientos

  for (const row of tableRows) {
    const result = classifyRow(row, page.pageNumber, header, bounds);
    if (result.kind === "end") {
      ended = true;
      break;
    }
    if (result.kind === "movement") {
      if (previous === "movement") pitch = Math.min(pitch, previousY - row.y);
      drafts.push(result.draft);
    } else if (result.kind === "issue") {
      issues.push(result.issue);
    } else if (result.kind === "continuation") {
      // Solo se une si está justo debajo del movimiento anterior (descripción partida en dos líneas).
      const last = drafts[drafts.length - 1];
      const gap = previousY - row.y;
      const maxGap = Number.isFinite(pitch) ? pitch * 1.6 : row.words[0].height * 2;
      if (last && (previous === "movement" || previous === "continuation") && gap <= maxGap) {
        last.description = normalizeDescription(`${last.description} ${result.text}`);
        joinedLines += 1;
      }
    }
    previous = result.kind;
    previousY = row.y;
  }
  return { hasTable: true, drafts, issues, joinedLines, ended, headerArea: rows.slice(0, header.rowIndex) };
}

// ---------------------------------------------------------------------------
// Datos de la cuenta y bloque RESUMEN
// ---------------------------------------------------------------------------

/** Índice de la palabra siguiente a la etiqueta dentro de la fila, o -1. */
function afterLabel(row: TextRow, label: string): number {
  const parts = label.split(" ");
  const keys = row.words.map(wordKey);
  for (let i = 0; i + parts.length <= keys.length; i++) {
    if (parts.every((p, k) => keys[i + k] === p)) return i + parts.length;
  }
  return -1;
}

function readTotals(rows: TextRow[]): StatementTotals {
  const totals: StatementTotals = {};
  for (const row of rows) {
    for (const [field, label] of TOTAL_LABELS) {
      const start = afterLabel(row, label);
      if (start < 0 || totals[field] !== undefined) continue;
      const amount = row.words.slice(start).find((w) => isStatementAmount(w.text));
      if (amount) totals[field] = parseStatementAmount(amount.text)!;
    }
  }
  return totals;
}

interface AccountInfo {
  accountNumber?: string;
  periodFrom?: string; // AAAA/MM/DD
  periodTo?: string;
}

function readAccountInfo(rows: TextRow[]): AccountInfo {
  const info: AccountInfo = {};
  const ymd = /^\d{4}\/\d{2}\/\d{2}$/;
  for (const row of rows) {
    const next = (label: string) => {
      const i = afterLabel(row, label);
      return i >= 0 ? row.words[i]?.text : undefined;
    };
    const number = next("numero");
    if (!info.accountNumber && number && /^\d{6,}$/.test(number)) info.accountNumber = number;
    const from = next("desde");
    if (!info.periodFrom && from && ymd.test(from)) info.periodFrom = from;
    const to = next("hasta");
    if (!info.periodTo && to && ymd.test(to)) info.periodTo = to;
  }
  return info;
}

/** "2/01" + periodo 2025/12/31–2026/01/31 → "02/01/2026". */
function fullDate(date: string, info: AccountInfo): string | undefined {
  const m = DATE.exec(date);
  if (!m || !info.periodFrom || !info.periodTo) return undefined;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  const from = info.periodFrom.replace(/\//g, "");
  const to = info.periodTo.replace(/\//g, "");
  for (const year of new Set([to.slice(0, 4), from.slice(0, 4)])) {
    const candidate = `${year}${month}${day}`;
    if (candidate >= from && candidate <= to) return `${day}/${month}/${year}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

export function parseBancolombiaStatement(doc: PdfDocumentText): ParsedStatement {
  const allText = normalizeKey(doc.pages.flatMap((p) => p.items.map((i) => i.text)).join(" "));
  if (!allText.includes("bancolombia")) throw new StatementError(BANCOLOMBIA_MESSAGES.format);

  const drafts: RowDraft[] = [];
  const issues: ParseIssue[] = [];
  const movementsByPage: Record<number, number> = {};
  const headerAreas: TextRow[] = [];
  let joinedLines = 0;
  let tables = 0;

  for (const page of doc.pages) {
    const result = parsePage(page);
    headerAreas.push(...result.headerArea);
    if (!result.hasTable) continue;
    tables += 1;
    movementsByPage[page.pageNumber] = result.drafts.length;
    drafts.push(...result.drafts);
    issues.push(...result.issues);
    joinedLines += result.joinedLines;
    if (result.ended) break;
  }

  if (tables === 0) throw new StatementError(BANCOLOMBIA_MESSAGES.format);
  if (drafts.length === 0) throw new StatementError(BANCOLOMBIA_MESSAGES.noMovements);

  const info = readAccountInfo(headerAreas);
  const movements: BankMovement[] = drafts.map((d, index) => ({
    index,
    date: d.date,
    fullDate: fullDate(d.date, info),
    description: d.description,
    valueCents: d.valueCents,
    balanceCents: d.balanceCents,
    branch: d.branch,
    document: d.document,
    page: d.page,
    sign: signOf(d.valueCents),
  }));

  return {
    bank: "Bancolombia",
    ...info,
    pageCount: doc.pageCount,
    movementsByPage,
    movements,
    totals: readTotals(headerAreas),
    issues,
    joinedLines,
  };
}
