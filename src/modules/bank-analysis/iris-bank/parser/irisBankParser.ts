/**
 * Parser del «Estado Cuenta Empresarial» de Iris Bank (PDF con texto real).
 *
 * Estructura del formato soportado (construida sobre un extracto real de 69
 * páginas):
 * - La primera página trae el periodo («01/01/2026 al 31/01/2026»), la
 *   cuenta («Cuenta N°: …») y el resumen en dos columnas: Saldo Mes
 *   Anterior, Total Abonos, Total Cargos, Saldo Actual… (cada etiqueta con
 *   su «$ importe» a la derecha).
 * - Cada página repite el encabezado DÍA | REFERENCIA | DESCRIPCIÓN |
 *   MOVIMIENTOS | SALDO. Día, Referencia y Descripción están alineados a la
 *   izquierda bajo su título; Movimientos y Saldo, a la derecha.
 * - Día llega como "01/01/26". Movimientos y Saldo llegan como
 *   "$ -2,223,606.00" (signo delante del número, coma de miles, punto
 *   decimal).
 * - Una descripción larga ocupa varias líneas CENTRADAS verticalmente en la
 *   fila: con dos líneas, una queda por encima y otra por debajo de la línea
 *   del día/valor, que no lleva texto en Descripción.
 * - Debajo de la tabla hay un bloque de tasas («PLAN ACTUAL | TASA E.A.»)
 *   y el pie «página N de M»: no son movimientos.
 *
 * Las filas se reconstruyen con coordenadas (rows.ts) y las columnas se
 * deducen del encabezado de cada página.
 */
import { normalizeKey } from "../../../../utils/text";
import { normalizeDescription } from "../../shared/groupingService";
import { parseStatementAmount, signOf } from "../../shared/money";
import type { PdfDocumentText, PdfPageText } from "../../shared/pdf/pdfTypes";
import { buildRows, joinWords, type TextRow, type Word } from "../../shared/pdf/rows";
import { StatementError, type BankMovement, type ParseIssue, type ParsedStatement, type StatementTotals } from "../../shared/types";

export const IRIS_BANK_MESSAGES = {
  format: "El PDF no coincide con el formato Iris Bank soportado.",
  noMovements: "No se encontraron movimientos en el archivo.",
  noMovementsColumn: "No fue posible identificar la columna Movimientos.",
} as const;

const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;
/** Fragmento que forma parte de un importe: "$", "-", "-$", "$-2,000.00", "2,000.00"… */
const MONEY_PREFIX = /^-?\$?-?$/;
const MONEY_AMOUNT = /^-?\$?-?(?:\d{1,3}(?:,\d{3})*|\d+)?\.\d{2}$/;
const FOOTER = /^pagina \d+ de \d+$/;

const HEADER_KEYS = ["dia", "referencia", "descripcion", "movimientos", "saldo"] as const;

const TOTAL_LABELS: [keyof StatementTotals, string][] = [
  ["previousBalanceCents", "saldo mes anterior"],
  ["totalCreditsCents", "total abonos"],
  ["totalDebitsCents", "total cargos"],
  ["currentBalanceCents", "saldo actual"],
];

const wordKey = (w: Word) => normalizeKey(w.text).replace(/[.:]+$/, "");

/** "$ -2,223,606.00" → -222360600 centavos. null si no es un importe exacto. */
export function parseIrisBankAmount(text: string): number | null {
  const compact = text.replace(/\s+/g, "");
  const negative = /^-?\$?-/.test(compact);
  const cents = parseStatementAmount(compact.replace(/^-?\$?-?/, ""));
  if (cents === null) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/** "01/01/26" → { day: "01", month: "01", year: 2026 }. null si no es una fecha válida. */
function parseDay(text: string): { day: string; month: string; year: number } | null {
  const m = DATE.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return { day: m[1].padStart(2, "0"), month: m[2].padStart(2, "0"), year: m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]) };
}

// ---------------------------------------------------------------------------
// Encabezado y columnas
// ---------------------------------------------------------------------------

interface Header {
  rowIndex: number;
  /** Inicio de Referencia (fin de Día). */
  referenceStart: number;
  /** Inicio de Descripción (fin de Referencia). */
  descriptionStart: number;
  /** Borde derecho de Movimientos y de Saldo (columnas alineadas a la derecha). */
  movementsRight: number;
  balanceRight: number;
  /** Margen para diferencias mínimas de posición. */
  tolerance: number;
  fontHeight: number;
}

/** Busca la fila de títulos de la tabla. null si la página no tiene tabla. */
function findHeader(rows: TextRow[]): Header | null {
  for (let i = 0; i < rows.length; i++) {
    const byKey = new Map<string, Word>();
    for (const w of rows[i].words) if (!byKey.has(wordKey(w))) byKey.set(wordKey(w), w);
    if (!byKey.has("dia") || !byKey.has("referencia") || !byKey.has("descripcion")) continue;
    if (!byKey.has("movimientos")) throw new StatementError(IRIS_BANK_MESSAGES.noMovementsColumn);
    if (!byKey.has("saldo")) throw new StatementError(IRIS_BANK_MESSAGES.format);
    const [dia, referencia, descripcion, movimientos, saldo] = HEADER_KEYS.map((k) => byKey.get(k)!);
    if (!(dia.x < referencia.x && referencia.x < descripcion.x && descripcion.right < movimientos.right && movimientos.right < saldo.right)) {
      throw new StatementError(IRIS_BANK_MESSAGES.format);
    }
    return {
      rowIndex: i,
      referenceStart: referencia.x,
      descriptionStart: descripcion.x,
      movementsRight: movimientos.right,
      balanceRight: saldo.right,
      tolerance: Math.max(2, 0.75 * descripcion.charWidth),
      fontHeight: descripcion.height,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

interface MoneyCell {
  words: Word[];
  x: number;
  right: number;
  cents: number | null;
}

/**
 * Importes al final de la fila, de derecha a izquierda: cada uno es un
 * número con dos decimales y, pegados a su izquierda, "$" y/o "-".
 */
function trailingMoney(words: Word[], h: Header): { cells: MoneyCell[]; rest: Word[] } {
  const cells: MoneyCell[] = [];
  let end = words.length;
  while (end > 0 && cells.length < 2) {
    const amount = words[end - 1];
    if (!MONEY_AMOUNT.test(amount.text) || amount.x < h.descriptionStart) break;
    let start = end - 1;
    while (start > 0) {
      const prev = words[start - 1];
      const gap = words[start].x - prev.right;
      if (!MONEY_PREFIX.test(prev.text) || gap > 2 * prev.charWidth) break;
      start -= 1;
    }
    const part = words.slice(start, end);
    cells.unshift({ words: part, x: part[0].x, right: amount.right, cents: parseIrisBankAmount(part.map((w) => w.text).join("")) });
    end = start;
  }
  return { cells, rest: words.slice(0, end) };
}

interface Anchor {
  kind: "movement";
  y: number;
  page: number;
  date: string;
  day: string;
  month: string;
  year: number;
  reference?: string;
  /** Descripción en la misma línea del día (vacía si la celda tiene dos líneas). */
  description: Word[];
  valueCents: number;
  balanceCents?: number;
  /** Líneas de descripción encima y debajo (celdas multilínea). */
  above: Word[][];
  below: Word[][];
}

type RowResult =
  | Anchor
  | { kind: "fragment"; y: number; words: Word[] }
  | { kind: "issue"; issue: ParseIssue }
  | { kind: "other" };

function classifyRow(row: TextRow, page: number, h: Header): RowResult {
  const text = joinWords(row.words);
  if (FOOTER.test(normalizeKey(text))) return { kind: "other" };

  const { cells, rest } = trailingMoney(row.words, h);
  const date: Word[] = [];
  const reference: Word[] = [];
  const description: Word[] = [];
  for (const w of rest) {
    if (w.x < h.referenceStart - h.tolerance) date.push(w);
    else if (w.x < h.descriptionStart - h.tolerance) reference.push(w);
    else description.push(w);
  }

  // Cada importe va a la columna cuyo borde derecho está más cerca.
  let movement: MoneyCell | undefined;
  let balance: MoneyCell | undefined;
  for (const cell of cells) {
    if (Math.abs(cell.right - h.movementsRight) <= Math.abs(cell.right - h.balanceRight)) movement ??= cell;
    else balance ??= cell;
  }

  if (date.length === 0 && reference.length === 0 && cells.length === 0) {
    // Solo texto en Descripción: posible línea de una descripción multilínea.
    return description.length > 0 ? { kind: "fragment", y: row.y, words: description } : { kind: "other" };
  }

  const parsedDate = date.length === 1 ? parseDay(date[0].text) : null;
  // Filas fuera de la tabla (bloque de tasas, textos legales): sin día válido ni importe en Movimientos.
  if (!parsedDate && !movement) return { kind: "other" };

  const reason = !parsedDate
    ? "La fila no tiene un día válido."
    : !movement
      ? "La fila no tiene valor en Movimientos."
      : movement.cents === null
        ? `Movimiento no interpretable: "${joinWords(movement.words)}".`
        : balance && balance.cents === null
          ? `Saldo no interpretable: "${joinWords(balance.words)}".`
          : null;
  if (reason) return { kind: "issue", issue: { page, text, reason } };

  return {
    kind: "movement",
    y: row.y,
    page,
    date: date[0].text,
    ...parsedDate!,
    reference: reference.length ? joinWords(reference) : undefined,
    description,
    valueCents: movement!.cents!,
    balanceCents: balance?.cents ?? undefined,
    above: [],
    below: [],
  };
}

interface PageResult {
  hasTable: boolean;
  anchors: Anchor[];
  issues: ParseIssue[];
  joinedLines: number;
  /** Filas encima del encabezado (datos de la cuenta y resumen). */
  headerArea: TextRow[];
}

/**
 * Une cada línea suelta de Descripción a la fila (día + valor) más cercana,
 * siempre que entre ambas no haya un salto mayor que el interlineado de una
 * celda. Así una descripción centrada en dos o más líneas se reconstruye
 * completa, y el texto que no pertenece a ninguna fila nunca se pega a una.
 */
function attachFragments(anchors: Anchor[], fragments: { y: number; words: Word[] }[], h: Header, page: number): { issues: ParseIssue[]; joined: number } {
  const issues: ParseIssue[] = [];
  let joined = 0;
  const maxLineGap = 1.6 * h.fontHeight;
  const owner = (y: number) => {
    let best: Anchor | undefined;
    let tie = false;
    for (const a of anchors) {
      const d = Math.abs(a.y - y);
      const bestD = best ? Math.abs(best.y - y) : Infinity;
      if (d < bestD - 0.5) {
        best = a;
        tie = false;
      } else if (Math.abs(d - bestD) <= 0.5) tie = true;
    }
    return tie ? undefined : best;
  };

  const attached = new Set<number>();
  for (const anchor of anchors) {
    // Hacia arriba (de la más cercana a la más lejana) y luego hacia abajo.
    for (const direction of [1, -1] as const) {
      let lastY = anchor.y;
      const side = fragments
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => (f.y - anchor.y) * direction > 0)
        .sort((a, b) => Math.abs(a.f.y - anchor.y) - Math.abs(b.f.y - anchor.y));
      for (const { f, i } of side) {
        if (attached.has(i) || Math.abs(f.y - lastY) > maxLineGap || owner(f.y) !== anchor) break;
        const sameFont = f.words.every((w) => Math.abs(w.height - h.fontHeight) <= 1);
        if (!sameFont) break;
        (direction === 1 ? anchor.above : anchor.below).push(f.words);
        attached.add(i);
        joined += 1;
        lastY = f.y;
      }
    }
  }

  // Texto de Descripción suelto DENTRO de la tabla (antes de la última fila): se informa.
  const lastY = anchors.length ? anchors[anchors.length - 1].y : -Infinity;
  fragments.forEach((f, i) => {
    if (attached.has(i) || f.y < lastY) return;
    issues.push({ page, text: joinWords(f.words), reason: "Texto en Descripción sin día ni valor que no pudo asociarse a ningún movimiento." });
  });
  return { issues, joined };
}

function parsePage(page: PdfPageText): PageResult {
  const rows = buildRows(page.items);
  const header = findHeader(rows);
  if (!header) return { hasTable: false, anchors: [], issues: [], joinedLines: 0, headerArea: rows };

  const anchors: Anchor[] = [];
  const fragments: { y: number; words: Word[] }[] = [];
  const issues: ParseIssue[] = [];
  for (const row of rows.slice(header.rowIndex + 1)) {
    const r = classifyRow(row, page.pageNumber, header);
    if (r.kind === "movement") anchors.push(r);
    else if (r.kind === "fragment") fragments.push(r);
    else if (r.kind === "issue") issues.push(r.issue);
  }
  const attached = attachFragments(anchors, fragments, header, page.pageNumber);
  return {
    hasTable: true,
    anchors,
    issues: [...issues, ...attached.issues],
    joinedLines: attached.joined,
    headerArea: rows.slice(0, header.rowIndex),
  };
}

/** Descripción completa: líneas de arriba (de arriba hacia abajo), la de la fila y las de abajo. */
function fullDescription(a: Anchor): string {
  const lines = [...[...a.above].reverse(), a.description, ...a.below].filter((l) => l.length > 0);
  return normalizeDescription(lines.map(joinWords).join(" "));
}

// ---------------------------------------------------------------------------
// Datos de la cuenta y resumen
// ---------------------------------------------------------------------------

/** Importe que sigue a una etiqueta del resumen ("$", "40,549,400.47"). */
function amountAfter(words: Word[], start: number): number | null {
  const parts: string[] = [];
  for (let i = start; i < words.length && parts.length < 3; i++) {
    const t = words[i].text;
    if (MONEY_PREFIX.test(t)) parts.push(t);
    else if (MONEY_AMOUNT.test(t)) return parseIrisBankAmount([...parts, t].join(""));
    else break;
  }
  return null;
}

function readTotals(rows: TextRow[]): StatementTotals {
  const totals: StatementTotals = {};
  for (const row of rows) {
    const keys = row.words.map(wordKey);
    for (const [field, label] of TOTAL_LABELS) {
      if (totals[field] !== undefined) continue;
      const labelKeys = label.split(" ");
      for (let i = 0; i + labelKeys.length <= keys.length; i++) {
        if (!labelKeys.every((k, j) => keys[i + j] === k)) continue;
        const amount = amountAfter(row.words, i + labelKeys.length);
        if (amount !== null) totals[field] = amount;
        break;
      }
    }
  }
  return totals;
}

interface AccountInfo {
  accountNumber?: string;
  /** AAAA/MM/DD */
  periodFrom?: string;
  periodTo?: string;
}

function readAccountInfo(rows: TextRow[]): AccountInfo {
  const info: AccountInfo = {};
  const toIso = (d: string) => d.split("/").reverse().join("/");
  for (const row of rows) {
    const text = joinWords(row.words);
    const account = /cuenta\s+n\S{0,2}\s*:?\s*(\d[\d-]{5,}\d)/i.exec(text);
    if (!info.accountNumber && account) info.accountNumber = account[1];
    const period = /(\d{2}\/\d{2}\/\d{4})\s+al\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text);
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

export function parseIrisBankStatement(doc: PdfDocumentText): ParsedStatement {
  const allText = normalizeKey(doc.pages.flatMap((p) => p.items.map((i) => i.text)).join(" "));
  if (!allText.includes("iris")) throw new StatementError(IRIS_BANK_MESSAGES.format);

  const anchors: Anchor[] = [];
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
    movementsByPage[page.pageNumber] = result.anchors.length;
    anchors.push(...result.anchors);
    issues.push(...result.issues);
    joinedLines += result.joinedLines;
  }

  if (tables === 0) throw new StatementError(IRIS_BANK_MESSAGES.format);
  if (anchors.length === 0) throw new StatementError(IRIS_BANK_MESSAGES.noMovements);

  const movements: BankMovement[] = [];
  for (const a of anchors) {
    const description = fullDescription(a);
    if (!description) {
      issues.push({ page: a.page, text: `${a.date} ${a.reference ?? ""}`.trim(), reason: "La fila no tiene Descripción." });
      continue;
    }
    movements.push({
      index: movements.length,
      date: a.date,
      fullDate: `${a.day}/${a.month}/${a.year}`,
      description,
      valueCents: a.valueCents,
      balanceCents: a.balanceCents,
      // En Iris Bank la columna se llama Referencia.
      document: a.reference,
      page: a.page,
      sign: signOf(a.valueCents),
    });
  }

  return {
    bank: "Iris Bank",
    ...readAccountInfo(headerAreas),
    pageCount: doc.pageCount,
    movementsByPage,
    movements,
    totals: readTotals(headerAreas),
    issues,
    joinedLines,
  };
}
