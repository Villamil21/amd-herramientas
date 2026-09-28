/**
 * Parser del extracto de cuenta de Davivienda (PDF con texto real).
 *
 * Estructura del formato soportado (construida sobre un extracto real):
 * - La primera página trae los datos de la cuenta, «INFORME DEL MES:» y el
 *   resumen Saldo Anterior / Más Créditos / Menos Débitos / Nuevo Saldo /
 *   Saldo Promedio encima de la tabla.
 * - Cada página repite el encabezado Fecha | Valor | Doc. | Clase de
 *   Movimiento | Oficina. No hay fila de cierre: la tabla acaba donde acaban
 *   los movimientos y debajo solo hay textos institucionales.
 * - La fecha llega como dos fragmentos "DD" "MM", sin año.
 * - El valor llega como "$ 2,900,000.00" y el signo va DESPUÉS, casi siempre
 *   como fragmento aparte: "+" entra dinero, "-" sale dinero.
 * - La Oficina usa una letra más pequeña y queda ~1 pt más arriba, pero en
 *   la misma fila visual. Algunas clases continúan en una segunda línea
 *   (sin fecha, valor ni documento), p. ej. "TRANSFERENCIA TERCEROS".
 *
 * Las filas se reconstruyen con coordenadas (rows.ts). Los títulos están
 * centrados sobre columnas contiguas: midiendo dónde empieza el texto de la
 * Clase de Movimiento se deduce dónde termina cada columna (fin = 2·centro −
 * inicio). Así la Oficina nunca se mezcla con la Clase.
 */
import { normalizeKey } from "../../../../utils/text";
import { normalizeDescription } from "../../shared/groupingService";
import { parseStatementAmount, signOf } from "../../shared/money";
import type { PdfDocumentText, PdfPageText } from "../../shared/pdf/pdfTypes";
import { buildRows, center, joinWords, type TextRow, type Word } from "../../shared/pdf/rows";
import { StatementError, type BankMovement, type ParseIssue, type ParsedStatement, type StatementTotals } from "../../shared/types";

export const DAVIVIENDA_MESSAGES = {
  format: "El PDF no coincide con el formato Davivienda soportado.",
  noMovements: "No se encontraron movimientos en el archivo.",
  noValueColumn: "No fue posible identificar la columna Valor.",
} as const;

/** "$2,900,000.00+" (ya sin espacios): importe con coma de miles, punto decimal y signo al final. */
const SIGNED_VALUE = /^\$?((?:\d{1,3}(?:,\d{3})*|\d+)?\.\d{2})([+-])$/;
/** Fragmentos que pueden formar parte de un valor: "$", "2,900,000.00", "+", "-" o combinaciones. */
const VALUE_PART = /^\$?(?:(?:\d{1,3}(?:,\d{3})*|\d+)?\.\d{2})?[+-]?$/;
const DATE = /^(\d{1,2})[ /](\d{1,2})$/;

const TOTAL_LABELS: [keyof StatementTotals, string][] = [
  ["previousBalanceCents", "saldo anterior"],
  ["totalCreditsCents", "mas creditos"],
  ["totalDebitsCents", "menos debitos"],
  ["currentBalanceCents", "nuevo saldo"],
];

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const wordKey = (w: Word) => normalizeKey(w.text).replace(/[.:]+$/, "");

function validDate(text: string): { day: string; month: string } | null {
  const m = DATE.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return { day: m[1].padStart(2, "0"), month: m[2].padStart(2, "0") };
}

/** "$ 742,942.68-" → -74294268 centavos. null si falta el signo o el formato no es exacto. */
export function parseDaviviendaValue(text: string): number | null {
  const m = SIGNED_VALUE.exec(text.replace(/\s+/g, ""));
  if (!m) return null;
  const cents = parseStatementAmount(m[1]);
  if (cents === null) return null;
  return m[2] === "-" && cents !== 0 ? -cents : cents;
}

// ---------------------------------------------------------------------------
// Encabezado y columnas
// ---------------------------------------------------------------------------

interface Header {
  rowIndex: number;
  fecha: number;
  valor: number;
  doc: number;
  /** Centro del título «Clase de Movimiento» (tres palabras). */
  clase: number;
  oficina: number;
  docRight: number;
}

/** Busca la fila de títulos de la tabla. null si la página no tiene tabla. */
function findHeader(rows: TextRow[]): Header | null {
  for (let i = 0; i < rows.length; i++) {
    const byKey = new Map<string, Word>();
    for (const w of rows[i].words) if (!byKey.has(wordKey(w))) byKey.set(wordKey(w), w);
    if (!byKey.has("fecha") || !byKey.has("clase") || !byKey.has("movimiento")) continue;
    if (!byKey.has("valor")) throw new StatementError(DAVIVIENDA_MESSAGES.noValueColumn);
    if (!byKey.has("doc") || !byKey.has("oficina")) throw new StatementError(DAVIVIENDA_MESSAGES.format);
    const header: Header = {
      rowIndex: i,
      fecha: center(byKey.get("fecha")!),
      valor: center(byKey.get("valor")!),
      doc: center(byKey.get("doc")!),
      clase: (byKey.get("clase")!.x + byKey.get("movimiento")!.right) / 2,
      oficina: center(byKey.get("oficina")!),
      docRight: byKey.get("doc")!.right,
    };
    const { fecha, valor, doc, clase, oficina } = header;
    if (!(fecha < valor && valor < doc && doc < clase && clase < oficina)) throw new StatementError(DAVIVIENDA_MESSAGES.format);
    return header;
  }
  return null;
}

interface Bounds {
  /** Inicio de Valor (fin de Fecha). */
  valorStart: number;
  /** Inicio de Clase de Movimiento (fin de Doc.). */
  claseStart: number;
  /** Inicio de Oficina (fin de Clase de Movimiento). */
  claseEnd: number;
}

const dateWords = (row: TextRow, h: Header) => row.words.filter((w) => center(w) < h.valor && /^\d{1,2}$/.test(w.text));

/**
 * Límites de las columnas. El inicio de la Clase se mide en las filas con
 * fecha: es la primera palabra a la derecha del centro de Doc. (los números
 * de documento están centrados bajo su título).
 */
function columnBounds(rows: TextRow[], h: Header): Bounds | null {
  let claseStart = Infinity;
  for (const row of rows) {
    if (dateWords(row, h).length !== 2) continue;
    for (const w of row.words) if (w.x > h.doc && center(w) < h.oficina) claseStart = Math.min(claseStart, w.x);
  }
  if (!Number.isFinite(claseStart) || claseStart < h.docRight) return null;
  const docStart = 2 * h.doc - claseStart;
  return { valorStart: 2 * h.valor - docStart, claseStart, claseEnd: 2 * h.clase - claseStart };
}

// ---------------------------------------------------------------------------
// Filas de movimientos
// ---------------------------------------------------------------------------

interface RowDraft {
  page: number;
  date: string;
  day: string;
  month: string;
  movementClass: string;
  valueCents: number;
  document?: string;
  office?: string;
  /** Alto de letra de la clase: las continuaciones deben tener el mismo. */
  classHeight: number;
}

type RowResult =
  | { kind: "movement"; draft: RowDraft }
  | { kind: "continuation"; movementClass: Word[]; office: Word[] }
  | { kind: "issue"; issue: ParseIssue }
  | { kind: "other" };

function classifyRow(row: TextRow, page: number, h: Header, b: Bounds): RowResult {
  const text = joinWords(row.words);
  const date: Word[] = [];
  const value: Word[] = [];
  const doc: Word[] = [];
  const movementClass: Word[] = [];
  const office: Word[] = [];

  for (const w of row.words) {
    if (center(w) < b.valorStart) date.push(w);
    else if (w.x < b.claseStart) {
      // Zona Valor + Doc.: el valor se reconoce por su forma ($, importe, signo), el resto es Doc.
      if (VALUE_PART.test(w.text) && center(w) < h.doc) value.push(w);
      else doc.push(w);
    } else if (w.x < b.claseEnd) movementClass.push(w);
    else office.push(w);
  }

  if (date.length === 0 && value.length === 0) {
    // Sin fecha ni valor: posible segunda línea de la Clase o de la Oficina.
    const onlyText = doc.length === 0 && movementClass.length + office.length > 0;
    return onlyText ? { kind: "continuation", movementClass, office } : { kind: "other" };
  }

  const parsedDate = validDate(joinWords(date));
  const valueCents = parseDaviviendaValue(value.map((w) => w.text).join(""));
  // Filas fuera de la tabla con palabras en la zona de fecha (pie de página): no son movimientos.
  if (!parsedDate && value.length === 0) return { kind: "other" };

  const reason = !parsedDate
    ? "La fila no tiene una fecha válida."
    : value.length === 0
      ? "La fila no tiene valor."
      : valueCents === null
        ? `Valor no interpretable (debe terminar en + o -): "${joinWords(value)}".`
        : movementClass.length === 0
          ? "La fila no tiene Clase de Movimiento."
          : null;
  if (reason) return { kind: "issue", issue: { page, text, reason } };

  return {
    kind: "movement",
    draft: {
      page,
      date: `${parsedDate!.day} ${parsedDate!.month}`,
      ...parsedDate!,
      movementClass: joinWords(movementClass),
      valueCents: valueCents!,
      document: doc.length ? joinWords(doc) : undefined,
      office: office.length ? joinWords(office) : undefined,
      classHeight: movementClass[0].height,
    },
  };
}

interface PageResult {
  hasTable: boolean;
  drafts: RowDraft[];
  issues: ParseIssue[];
  joinedLines: number;
  /** Filas encima del encabezado (datos de la cuenta y resumen). */
  headerArea: TextRow[];
  bounds: Bounds | null;
}

function parsePage(page: PdfPageText, previousBounds: Bounds | null): PageResult {
  const rows = buildRows(page.items);
  const header = findHeader(rows);
  if (!header) return { hasTable: false, drafts: [], issues: [], joinedLines: 0, headerArea: rows, bounds: previousBounds };

  const tableRows = rows.slice(header.rowIndex + 1);
  // Mismo formato en todas las páginas: si esta no tiene filas con fecha, sirven los límites de la anterior.
  const bounds = columnBounds(tableRows, header) ?? previousBounds;
  const result: PageResult = { hasTable: true, drafts: [], issues: [], joinedLines: 0, headerArea: rows.slice(0, header.rowIndex), bounds };
  if (!bounds) return result;

  let previous: RowResult["kind"] | null = null;
  let previousY = rows[header.rowIndex].y;
  let pitch = Infinity; // distancia típica entre filas de movimientos

  for (const row of tableRows) {
    const r = classifyRow(row, page.pageNumber, header, bounds);
    if (r.kind === "movement") {
      if (previous === "movement") pitch = Math.min(pitch, previousY - row.y);
      result.drafts.push(r.draft);
    } else if (r.kind === "issue") {
      result.issues.push(r.issue);
    } else if (r.kind === "continuation") {
      // Solo se une si está justo debajo del movimiento anterior y con la misma letra de la tabla.
      const last = result.drafts[result.drafts.length - 1];
      const gap = previousY - row.y;
      const maxGap = Number.isFinite(pitch) ? pitch * 1.6 : row.words[0].height * 2;
      const sameFont = r.movementClass.every((w) => last && Math.abs(w.height - last.classHeight) <= 1);
      if (last && (previous === "movement" || previous === "continuation") && gap <= maxGap && sameFont) {
        if (r.movementClass.length) last.movementClass = `${last.movementClass} ${joinWords(r.movementClass)}`;
        if (r.office.length) last.office = [last.office, joinWords(r.office)].filter(Boolean).join(" ");
        result.joinedLines += 1;
      } else if (!last && r.movementClass.length && gap <= maxGap * 1.5) {
        // Texto de Clase justo bajo el encabezado, sin movimiento al que pertenezca.
        result.issues.push({ page: page.pageNumber, text: joinWords(row.words), reason: "Texto de Clase de Movimiento sin fecha ni valor al inicio de la tabla." });
      } else {
        previous = "other";
        previousY = row.y;
        continue;
      }
    }
    previous = r.kind;
    previousY = row.y;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Datos de la cuenta y resumen
// ---------------------------------------------------------------------------

/** "$5,480,135.37" → centavos. Los saldos del resumen no llevan signo al final. */
function parseSummaryAmount(text: string): number | null {
  const compact = text.replace(/\s+/g, "").replace(/^(-?)\$(-?)/, "$1$2");
  return parseStatementAmount(compact);
}

function readTotals(rows: TextRow[]): StatementTotals {
  const totals: StatementTotals = {};
  for (const row of rows) {
    const key = normalizeKey(joinWords(row.words));
    for (const [field, label] of TOTAL_LABELS) {
      if (totals[field] !== undefined || !key.startsWith(`${label} `)) continue;
      const labelWords = label.split(" ").length;
      const amount = parseSummaryAmount(row.words.slice(labelWords).map((w) => w.text).join(""));
      if (amount !== null) totals[field] = amount;
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
  rows.forEach((row, i) => {
    const text = joinWords(row.words);
    const key = normalizeKey(text);
    // Número de cuenta: la línea debajo de «CUENTA DE AHORROS» / «CUENTA CORRIENTE».
    if (!info.accountNumber && /^cuenta (de ahorros|corriente)$/.test(key)) {
      const next = rows[i + 1] && joinWords(rows[i + 1].words);
      if (next && /^\d[\d ]{6,}\d$/.test(next)) info.accountNumber = next;
    }
    // «INFORME DEL MES: ENERO /2026».
    const period = /informe del mes:? ([a-z]+) ?\/ ?(\d{4})/.exec(key);
    if (!info.periodFrom && period) {
      const month = MONTHS.indexOf(period[1]) + 1;
      if (month > 0) {
        const year = Number(period[2]);
        const mm = String(month).padStart(2, "0");
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        info.periodFrom = `${year}/${mm}/01`;
        info.periodTo = `${year}/${mm}/${lastDay}`;
      }
    }
  });
  return info;
}

/** "31 01" + informe de enero 2026 → "31/01/2026". Un mes posterior al del informe es del año anterior. */
function fullDate(d: RowDraft, info: AccountInfo): string | undefined {
  if (!info.periodTo) return undefined;
  const year = Number(info.periodTo.slice(0, 4));
  const reportMonth = Number(info.periodTo.slice(5, 7));
  return `${d.day}/${d.month}/${Number(d.month) > reportMonth ? year - 1 : year}`;
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

export function parseDaviviendaStatement(doc: PdfDocumentText): ParsedStatement {
  const allText = normalizeKey(doc.pages.flatMap((p) => p.items.map((i) => i.text)).join(" "));
  if (!allText.includes("davivienda")) throw new StatementError(DAVIVIENDA_MESSAGES.format);

  const drafts: RowDraft[] = [];
  const issues: ParseIssue[] = [];
  const movementsByPage: Record<number, number> = {};
  const headerAreas: TextRow[] = [];
  let joinedLines = 0;
  let tables = 0;
  let bounds: Bounds | null = null;

  for (const page of doc.pages) {
    const result = parsePage(page, bounds);
    headerAreas.push(...result.headerArea);
    bounds = result.bounds;
    if (!result.hasTable) continue;
    tables += 1;
    movementsByPage[page.pageNumber] = result.drafts.length;
    drafts.push(...result.drafts);
    issues.push(...result.issues);
    joinedLines += result.joinedLines;
  }

  if (tables === 0) throw new StatementError(DAVIVIENDA_MESSAGES.format);
  if (drafts.length === 0) throw new StatementError(DAVIVIENDA_MESSAGES.noMovements);

  const info = readAccountInfo(headerAreas);
  const movements: BankMovement[] = drafts.map((d, index) => ({
    index,
    date: d.date,
    fullDate: fullDate(d, info),
    description: normalizeDescription(d.movementClass),
    valueCents: d.valueCents,
    // En Davivienda la columna se llama Oficina.
    branch: d.office,
    document: d.document,
    page: d.page,
    sign: signOf(d.valueCents),
  }));

  return {
    bank: "Davivienda",
    ...info,
    pageCount: doc.pageCount,
    movementsByPage,
    movements,
    totals: readTotals(headerAreas),
    issues,
    joinedLines,
  };
}
