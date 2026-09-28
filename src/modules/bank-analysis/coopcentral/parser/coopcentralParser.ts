/**
 * Parser del extracto de cuenta de Coopcentral (PDF con texto real).
 *
 * Estructura del formato soportado (construida sobre un extracto real):
 * - Cada página repite los datos de la cuenta y el encabezado de la tabla,
 *   en dos líneas:
 *     CONCEPTO | DOCT | OFICINA | F.APLI | F.OPER | TRANS. ELECTRONICA | CREDITOS | DEBITOS | SALDO
 *                     TR.NAC.  | (A/M/D)| (A/M/D)| PAQUETE-LOTE-TRANS
 * - La primera fila es SALDO INICIAL y la última SALDO FINAL (0.00 en
 *   CREDITOS y DEBITOS; solo traen el saldo). No son movimientos.
 * - Debajo de la tabla, en todas las páginas, está el bloque «TOTALES DEL
 *   PERIODO AGRUPADOS POR CONCEPTO» y textos institucionales.
 * - Importes con coma de miles y punto decimal (337,208,000.00 · 4,807.95 ·
 *   0.00), siempre positivos. CREDITOS y DEBITOS muestran 0.00 cuando no
 *   aplican.
 * - Fuente monoespaciada. Columnas de texto alineadas a la izquierda bajo su
 *   título; CREDITOS, DEBITOS y SALDO alineados a la derecha.
 *
 * Por eso las filas se reconstruyen con coordenadas (rows.ts) y las columnas
 * se ubican con el encabezado de cada página: una palabra de texto pertenece a
 * la columna cuyo título empieza a su izquierda, y un importe a la columna
 * (CREDITOS, DEBITOS o SALDO) cuyo título termina más cerca de donde termina
 * el importe.
 *
 * El tipo (crédito o débito) lo decide la columna que trae el valor, nunca el
 * texto del concepto.
 */
import { normalizeKey } from "../../../../utils/text";
import { normalizeDescription } from "../../shared/groupingService";
import { isStatementAmount, parseStatementAmount } from "../../shared/money";
import type { PdfDocumentText, PdfPageText } from "../../shared/pdf/pdfTypes";
import { buildRows, center, joinWords, type TextRow, type Word } from "../../shared/pdf/rows";
import { StatementError, type ParseIssue } from "../../shared/types";
import type { CoopcentralAnomaly, CoopcentralMovement, CoopcentralPeriodTotals, CoopcentralStatement } from "../types";

export const COOPCENTRAL_MESSAGES = {
  format: "El PDF no coincide con el formato Coopcentral soportado.",
  noMovements: "No se encontraron movimientos en el archivo.",
  noAmountColumns: "No fue posible identificar las columnas CREDITOS y DEBITOS.",
} as const;

const TEXT_COLUMNS = ["concepto", "doct", "oficina", "f.apli", "f.oper", "trans"] as const;
type TextColumn = (typeof TEXT_COLUMNS)[number];
const AMOUNT_COLUMNS = ["creditos", "debitos", "saldo"] as const;
type AmountColumn = (typeof AMOUNT_COLUMNS)[number];

const OPENING = "saldo inicial";
const CLOSING = "saldo final";
const PERIOD_TOTALS = "totales del periodo";

const PERIOD_TOTAL_LABELS: [keyof CoopcentralPeriodTotals, string][] = [
  ["consignacionesCents", "consignaciones"],
  ["retirosCents", "retiros"],
  ["notasDebitoCents", "notas debito"],
  ["notasCreditoCents", "notas credito"],
  ["saldoEnCanjeCents", "saldo en canje"],
  ["interesesRecibidosCents", "intereses recibidos"],
  ["retencionCents", "retencion"],
  ["gmfCents", "gmf"],
];

const wordKey = (w: Word) => normalizeKey(w.text).replace(/[.:]+$/, "");

// ---------------------------------------------------------------------------
// Encabezado y columnas
// ---------------------------------------------------------------------------

interface Header {
  rowIndex: number;
  /** Columnas de texto presentes, con la x donde empieza su título (de izquierda a derecha). */
  textStarts: { column: TextColumn; x: number }[];
  /** Dónde termina cada título de importe (los importes se alinean a la derecha). */
  amountRights: Record<AmountColumn, number>;
  /** A partir de esta x (centro de la palabra) solo hay importes. */
  amountsStart: number;
}

/** Busca la fila de títulos de la tabla. null si la página no tiene tabla. */
function findHeader(rows: TextRow[]): Header | null {
  for (let i = 0; i < rows.length; i++) {
    const byKey = new Map<string, Word>();
    for (const w of rows[i].words) if (!byKey.has(wordKey(w))) byKey.set(wordKey(w), w);
    if (!byKey.has("concepto") || !byKey.has("saldo")) continue;
    if (!byKey.has("creditos") || !byKey.has("debitos")) throw new StatementError(COOPCENTRAL_MESSAGES.noAmountColumns);

    const amountRights = Object.fromEntries(AMOUNT_COLUMNS.map((c) => [c, byKey.get(c)!.right])) as Record<AmountColumn, number>;
    const firstAmountX = byKey.get("creditos")!.x;
    const textStarts = TEXT_COLUMNS.filter((c) => byKey.has(c)).map((column) => ({ column, x: byKey.get(column)!.x }));
    const ordered =
      textStarts.every((t, k) => k === 0 || textStarts[k - 1].x < t.x) &&
      textStarts[textStarts.length - 1].x < firstAmountX &&
      amountRights.creditos < amountRights.debitos &&
      amountRights.debitos < amountRights.saldo;
    if (!ordered) throw new StatementError(COOPCENTRAL_MESSAGES.format);

    // Límite entre el texto (p. ej. TRANS. ELECTRONICA) y la zona de importes.
    const lastTextRight = Math.max(...rows[i].words.filter((w) => w.x < firstAmountX).map((w) => w.right));
    return { rowIndex: i, textStarts, amountRights, amountsStart: (lastTextRight + firstAmountX) / 2 };
  }
  return null;
}

/** Columna de texto de una palabra: la última cuyo título empieza a su izquierda (con 2 caracteres de holgura). */
function textColumnOf(w: Word, h: Header): TextColumn {
  let column: TextColumn = h.textStarts[0].column;
  for (const t of h.textStarts) if (t.x - 2 * w.charWidth <= w.x) column = t.column;
  return column;
}

function amountColumnOf(w: Word, h: Header): AmountColumn {
  let best: AmountColumn = "creditos";
  for (const c of AMOUNT_COLUMNS) if (Math.abs(w.right - h.amountRights[c]) < Math.abs(w.right - h.amountRights[best])) best = c;
  return best;
}

// ---------------------------------------------------------------------------
// Filas de la tabla
// ---------------------------------------------------------------------------

/** Una fila de la tabla con importes, antes de interpretarla (movimiento, saldo o anomalía). */
interface RowDraft {
  page: number;
  text: string;
  concept: string;
  /** undefined si la columna viene vacía. */
  creditCents?: number;
  debitCents?: number;
  balanceCents?: number;
  document?: string;
  office?: string;
  applicationDate?: string;
  operationDate?: string;
  electronicTransfer?: string;
}

type RowResult =
  | { kind: "end" }
  | { kind: "row"; draft: RowDraft }
  | { kind: "continuation"; text: string }
  | { kind: "issue"; issue: ParseIssue }
  | { kind: "other" };

/** "2026/02/10" (A/M/D) → "10/02/2026". Si no tiene ese formato se deja como está. */
function toDayMonthYear(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(text);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : text;
}

function classifyRow(row: TextRow, page: number, h: Header): RowResult {
  const text = joinWords(row.words);
  if (normalizeKey(text).includes(PERIOD_TOTALS)) return { kind: "end" };

  const cells = new Map<TextColumn, Word[]>();
  const amounts: Record<AmountColumn, Word[]> = { creditos: [], debitos: [], saldo: [] };
  const unreadable: Word[] = [];
  for (const w of row.words) {
    if (center(w) >= h.amountsStart) {
      if (isStatementAmount(w.text)) amounts[amountColumnOf(w, h)].push(w);
      else unreadable.push(w);
    } else {
      const column = textColumnOf(w, h);
      cells.set(column, [...(cells.get(column) ?? []), w]);
    }
  }
  const cell = (c: TextColumn) => (cells.has(c) ? joinWords(cells.get(c)!) : undefined);

  const hasAmounts = AMOUNT_COLUMNS.some((c) => amounts[c].length > 0);
  if (!hasAmounts && unreadable.length === 0) {
    // Solo texto en CONCEPTO: posible continuación del concepto anterior.
    const onlyConcept = cells.size === 1 && cells.has("concepto");
    return onlyConcept ? { kind: "continuation", text: cell("concepto")! } : { kind: "other" };
  }

  const reason = !cells.has("concepto")
    ? "La fila no tiene CONCEPTO."
    : unreadable.length > 0
      ? `Valor no interpretable: "${joinWords(unreadable)}".`
      : amounts.creditos.length > 1 || amounts.debitos.length > 1
        ? "No se pudieron separar los valores de CREDITOS y DEBITOS."
        : amounts.saldo.length > 1
          ? "No se pudo identificar el SALDO de la fila."
          : null;
  if (reason) return { kind: "issue", issue: { page, text, reason } };

  const cents = (c: AmountColumn) => (amounts[c].length ? parseStatementAmount(amounts[c][0].text)! : undefined);
  return {
    kind: "row",
    draft: {
      page,
      text,
      concept: normalizeDescription(cell("concepto")!),
      creditCents: cents("creditos"),
      debitCents: cents("debitos"),
      balanceCents: cents("saldo"),
      document: cell("doct"),
      office: cell("oficina"),
      applicationDate: toDayMonthYear(cell("f.apli")),
      operationDate: toDayMonthYear(cell("f.oper")),
      electronicTransfer: cell("trans"),
    },
  };
}

interface PageResult {
  hasTable: boolean;
  drafts: RowDraft[];
  issues: ParseIssue[];
  joinedLines: number;
  /** Filas encima del encabezado (datos de la cuenta). */
  headerArea: TextRow[];
  /** Filas desde «TOTALES DEL PERIODO» (bloque de totales y textos institucionales). */
  footerArea: TextRow[];
}

function parsePage(page: PdfPageText): PageResult {
  const rows = buildRows(page.items);
  const header = findHeader(rows);
  if (!header) return { hasTable: false, drafts: [], issues: [], joinedLines: 0, headerArea: rows, footerArea: rows };

  const drafts: RowDraft[] = [];
  const issues: ParseIssue[] = [];
  let joinedLines = 0;
  let footerStart = rows.length;
  let previous: RowResult["kind"] | null = null;
  let previousY = 0;
  let pitch = Infinity; // distancia típica entre filas de la tabla
  let rowHeight = 0; // tamaño de letra de las filas de la tabla

  for (let i = header.rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const height = Math.max(...row.words.map((w) => w.height));
    // Texto más grande que el de la tabla, una vez empezada: pie de página.
    const result = rowHeight > 0 && height > rowHeight * 1.25 ? ({ kind: "end" } as const) : classifyRow(row, page.pageNumber, header);
    if (result.kind === "end") {
      footerStart = i;
      break;
    }
    if (result.kind === "row") {
      if (previous === "row") pitch = Math.min(pitch, previousY - row.y);
      rowHeight = rowHeight || height;
      drafts.push(result.draft);
    } else if (result.kind === "issue") {
      issues.push(result.issue);
    } else if (result.kind === "continuation") {
      // Solo se une si está justo debajo de la fila anterior (concepto partido en dos líneas).
      const last = drafts[drafts.length - 1];
      const gap = previousY - row.y;
      const maxGap = Number.isFinite(pitch) ? pitch * 1.6 : row.words[0].height * 2;
      if (last && (previous === "row" || previous === "continuation") && gap <= maxGap) {
        last.concept = normalizeDescription(`${last.concept} ${result.text}`);
        joinedLines += 1;
      }
    }
    previous = result.kind;
    previousY = row.y;
  }
  return { hasTable: true, drafts, issues, joinedLines, headerArea: rows.slice(0, header.rowIndex), footerArea: rows.slice(footerStart) };
}

// ---------------------------------------------------------------------------
// Datos de la cuenta y bloque de totales
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
    const number = next("numero cuenta");
    if (!info.accountNumber && number && /^\d[\d-]{4,}$/.test(number)) info.accountNumber = number;
    const from = next("extracto de");
    if (!info.periodFrom && from && ymd.test(from)) info.periodFrom = from;
    const to = next("hasta");
    if (!info.periodTo && to && ymd.test(to)) info.periodTo = to;
  }
  return info;
}

/** Lee el bloque «TOTALES DEL PERIODO»: solo las palabras alineadas con su título (a la derecha del texto institucional). */
function readPeriodTotals(rows: TextRow[]): CoopcentralPeriodTotals {
  const totals: CoopcentralPeriodTotals = {};
  const titleRow = rows.findIndex((r) => normalizeKey(joinWords(r.words)).includes(PERIOD_TOTALS));
  if (titleRow < 0) return totals;
  const afterTitle = afterLabel(rows[titleRow], PERIOD_TOTALS);
  const titleX = afterTitle >= 3 ? rows[titleRow].words[afterTitle - 3].x : 0;
  for (const row of rows.slice(titleRow + 1)) {
    const words = row.words.filter((w) => w.x >= titleX - 2);
    const amount = words.filter((w) => isStatementAmount(w.text));
    if (amount.length !== 1) continue;
    const label = normalizeKey(joinWords(words.filter((w) => w !== amount[0])));
    const field = PERIOD_TOTAL_LABELS.find(([, l]) => l === label)?.[0];
    if (field && totals[field] === undefined) totals[field] = parseStatementAmount(amount[0].text)!;
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

export function parseCoopcentralStatement(doc: PdfDocumentText): CoopcentralStatement {
  const allText = normalizeKey(doc.pages.flatMap((p) => p.items.map((i) => i.text)).join(" "));
  if (!allText.includes("coopcentral")) throw new StatementError(COOPCENTRAL_MESSAGES.format);

  const movements: CoopcentralMovement[] = [];
  const anomalies: CoopcentralAnomaly[] = [];
  const issues: ParseIssue[] = [];
  const movementsByPage: Record<number, number> = {};
  const headerAreas: TextRow[] = [];
  let periodTotals: CoopcentralPeriodTotals = {};
  let openingBalanceCents: number | undefined;
  let closingBalanceCents: number | undefined;
  let joinedLines = 0;
  let tables = 0;
  let index = 0;

  for (const page of doc.pages) {
    const result = parsePage(page);
    headerAreas.push(...result.headerArea);
    const pageTotals = readPeriodTotals(result.footerArea);
    if (Object.keys(pageTotals).length > 0) periodTotals = pageTotals;
    if (!result.hasTable) continue;
    if (closingBalanceCents !== undefined) {
      // Ya se leyó SALDO FINAL: una tabla posterior no forma parte de este extracto.
      if (result.drafts.length > 0) issues.push({ page: page.pageNumber, text: result.drafts[0].text, reason: "Filas después de SALDO FINAL; no se tomaron como movimientos." });
      continue;
    }
    tables += 1;
    issues.push(...result.issues);
    joinedLines += result.joinedLines;
    movementsByPage[page.pageNumber] = 0;

    for (const d of result.drafts) {
      const credit = d.creditCents ?? 0;
      const debit = d.debitCents ?? 0;
      const key = normalizeKey(d.concept);
      const issue = (reason: string) => issues.push({ page: d.page, text: d.text, reason });

      if (closingBalanceCents !== undefined) {
        issue("Fila después de SALDO FINAL; no se tomó como movimiento.");
      } else if (key === OPENING || key === CLOSING) {
        // Filas de saldo: no son movimientos, solo aportan el saldo de apertura o de cierre.
        if (credit !== 0 || debit !== 0) issue(`La fila ${d.concept} trae valores en CREDITOS o DEBITOS.`);
        else if (d.balanceCents === undefined) issue(`La fila ${d.concept} no trae el saldo.`);
        else if (key === OPENING && (openingBalanceCents !== undefined || index > 0)) issue("SALDO INICIAL repetido o después de otros movimientos.");
        else if (key === OPENING) openingBalanceCents = d.balanceCents;
        else closingBalanceCents = d.balanceCents;
      } else if (credit < 0 || debit < 0) {
        issue("CREDITOS y DEBITOS deben ser valores positivos.");
      } else if (credit > 0 && debit > 0) {
        // No se decide en silencio: queda como anomalía para revisión.
        anomalies.push({ index: index++, page: d.page, concept: d.concept, creditCents: credit, debitCents: debit, balanceCents: d.balanceCents, text: d.text });
      } else if (credit === 0 && debit === 0) {
        issue("La fila no tiene valor en CREDITOS ni en DEBITOS.");
      } else {
        const transactionType = credit > 0 ? "credit" : "debit";
        movements.push({
          index: index++,
          concept: d.concept,
          creditCents: credit,
          debitCents: debit,
          transactionType,
          amountCents: transactionType === "credit" ? credit : debit,
          balanceCents: d.balanceCents,
          document: d.document,
          office: d.office,
          applicationDate: d.applicationDate,
          operationDate: d.operationDate,
          electronicTransfer: d.electronicTransfer,
          page: d.page,
        });
        movementsByPage[d.page] += 1;
      }
    }
  }

  if (tables === 0) throw new StatementError(COOPCENTRAL_MESSAGES.format);
  if (movements.length === 0 && anomalies.length === 0) throw new StatementError(COOPCENTRAL_MESSAGES.noMovements);

  return {
    bank: "Coopcentral",
    ...readAccountInfo(headerAreas),
    pageCount: doc.pageCount,
    movementsByPage,
    movements,
    anomalies,
    issues,
    openingBalanceCents,
    closingBalanceCents,
    periodTotals,
    joinedLines,
  };
}
