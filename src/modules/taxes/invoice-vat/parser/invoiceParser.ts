import type { PdfDocumentText } from "../../../bank-analysis/shared/pdf/pdfTypes";
import { buildRows, center, joinWords, type TextRow, type Word } from "../../../bank-analysis/shared/pdf/rows";
import { normalizeKey } from "../../../../utils/text";
import { productRowKey, readProductDescriptions } from "../../withholding/parser/productTable";
import type { InvoiceLine, LineIssue, ParsedInvoice, ProductLine } from "../types";
import { isCopAmount, parseCopAmount, parseDotDecimal, parseRate } from "./amounts";

/**
 * Lector de la representación gráfica DIAN de facturas electrónicas.
 *
 * - Título: el texto más grande de la página 1, antes de «Datos del …».
 * - Emisor: NIT y razón social de la sección «Datos del Emisor / Vendedor».
 * - Tabla «Detalles de Productos»: las columnas IVA, % y «Precio unitario de
 *   venta» se ubican por los encabezados; cada palabra de una fila se asigna
 *   por su posición. La tabla puede seguir en otras páginas (con o sin
 *   encabezado repetido) y termina en la siguiente sección (Notas Finales,
 *   Datos Totales…). «Hoja N de M» se ignora.
 * - Datos Totales: Subtotal, Total Bruto e IVA de la caja que tiene valores.
 *
 * No depende del proveedor, del número de páginas ni de valores concretos.
 */

/** El PDF no corresponde al modelo soportado (se marca «No compatible»). */
export class InvoiceFormatError extends Error {}

export interface PageRows {
  page: number;
  rows: TextRow[];
}

export const FOOTER = /^(hoja|p[aá]gina)\s+\d+\s+de\s+\d+$/i;
export const DETAILS_HEADING = /^detalles? de (los )?productos?/;
export const ISSUER_HEADING = /^datos del (emisor|vendedor)/;
const FIRST_SECTION = /^datos del /;
export const GRAPHIC = /^representacion grafica/;
/** Encabezados que pueden repetirse arriba de una página donde continúa la tabla. */
export const CONTINUATION_HEADINGS = [DETAILS_HEADING, GRAPHIC];

export const NIT_LABEL = /^nit( del)?( emisor| vendedor)?\s*:/i;
export const NAME_LABEL = /^raz[oó]n social\s*:/i;
export const TRADE_NAME_LABEL = /^nombre comercial\s*:/i;
export const NUMBER_LABEL = /^n[uú]mero( de)? (factura|documento|nota)[^:]*:/i;

export const rowText = (r: TextRow) => joinWords(r.words);
export const rowKey = (r: TextRow) => normalizeKey(rowText(r));
export const rowHeight = (r: TextRow) => Math.max(...r.words.map((w) => w.height));
export const isMoney = (w: Word) => w.text !== "$" && isCopAmount(w.text);
/** Valor con coma decimal ("1,00", "58.739,00"): distingue importes de códigos numéricos. */
export const isDecimalMoney = (w: Word) => /,\d{2}$/.test(w.text) && isCopAmount(w.text);

/**
 * Celdas de una fila: palabras separadas por un espacio grande. La etiqueta
 * y su valor quedan juntos ("Nit del Emisor: 900319753"); el siguiente par
 * de la misma fila queda en otra celda.
 */
export function cells(row: TextRow): string[] {
  const groups: Word[][] = [];
  for (const w of row.words) {
    const current = groups[groups.length - 1];
    const prev = current?.[current.length - 1];
    if (prev && w.x - prev.right <= Math.max(8, 3 * Math.min(prev.charWidth, w.charWidth))) current.push(w);
    else groups.push([w]);
  }
  return groups.map(joinWords);
}

/** Valor de «Etiqueta: valor» (en la misma celda o en la siguiente). */
export function findField(rows: TextRow[], label: RegExp): string | undefined {
  for (const row of rows) {
    const cs = cells(row);
    for (let i = 0; i < cs.length; i++) {
      const m = label.exec(cs[i]);
      if (!m) continue;
      const rest = cs[i].slice(m[0].length).trim();
      if (rest) return rest;
      const next = cs[i + 1];
      if (next && !next.endsWith(":")) return next.trim();
    }
  }
  return undefined;
}

/** "900.319.753-1" → "900319753". */
export function normalizeNit(value: string): string {
  return (value.split("-")[0] ?? "").replace(/\D/g, "");
}

/** Texto del código QR ("NitFac: 900319753 … ValIva: 44083.00"), respaldo de algunos datos. */
export function qrField(pages: PageRows[], name: string): string | undefined {
  const re = new RegExp(`\\b${name}:\\s*(\\S+)`);
  for (const p of pages) {
    for (const r of p.rows) {
      const m = re.exec(rowText(r));
      if (m) return m[1];
    }
  }
  return undefined;
}

export function detectTitle(rows: TextRow[]): string | undefined {
  const end = rows.findIndex((r) => FIRST_SECTION.test(rowKey(r)) || DETAILS_HEADING.test(rowKey(r)));
  const candidates = (end === -1 ? rows : rows.slice(0, end)).filter((r) => {
    const key = rowKey(r);
    return key && !GRAPHIC.test(key) && key !== "dian" && !FOOTER.test(rowText(r));
  });
  if (candidates.length === 0) return undefined;
  const max = Math.max(...candidates.map(rowHeight));
  const title = candidates
    .filter((r) => rowHeight(r) >= max - 0.5)
    .map(rowText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return title || undefined;
}

// ---------------------------------------------------------------------------
// Tabla «Detalles de Productos»
// ---------------------------------------------------------------------------

/** Límites horizontales (x) de las zonas de la tabla, deducidos de los encabezados. */
export interface ColumnAnchors {
  /** Inicio de la zona IVA + %. */
  taxLeft: number;
  /** Fin de la zona IVA + % (antes de INC). */
  taxRight: number;
  /** Punto medio entre IVA y %: solo para filas con un único valor en la zona. */
  taxSplit: number;
  /** Inicio de la columna «Precio unitario de venta». */
  saleLeft: number;
}

const isIva = (w: Word) => /^iva$/i.test(w.text);
const isPercent = (w: Word) => w.text === "%";

export function isHeaderRow(row: TextRow): boolean {
  const iva = row.words.find(isIva);
  return Boolean(iva && row.words.some((w) => isPercent(w) && w.x > iva.right));
}

/**
 * Columnas a partir de la fila de encabezado que contiene «IVA» y «%»
 * (index) y de las filas vecinas sin importes (encabezados en varias
 * líneas, como «Precio / unitario de / venta»).
 */
export function findAnchors(rows: TextRow[], index: number): ColumnAnchors | undefined {
  const headerRow = rows[index];
  const iva = headerRow.words.find(isIva);
  if (!iva) return undefined;
  const pct = headerRow.words.filter((w) => isPercent(w) && w.x > iva.right).sort((a, b) => a.x - b.x)[0];
  if (!pct) return undefined;

  // Filas vecinas (hasta 24 pt arriba o abajo) que no son filas de productos.
  const band: Word[] = [];
  for (let i = index; i >= 0 && rows[i].y - headerRow.y <= 24 && !rows[i].words.some(isDecimalMoney); i--) band.push(...rows[i].words);
  for (let i = index + 1; i < rows.length && headerRow.y - rows[i].y <= 24 && !rows[i].words.some(isDecimalMoney); i++) band.push(...rows[i].words);
  const venta = band.filter((w) => /^venta$/i.test(w.text) && w.x > pct.right).sort((a, b) => a.x - b.x)[0];
  if (!venta) return undefined;
  const saleHeaderLeft = Math.min(...band.filter((w) => w.right > venta.x - 5 && w.x < venta.right + 5).map((w) => w.x));

  const leftOfIva = headerRow.words.filter((w) => w.right < iva.x);
  const taxLeft = leftOfIva.length ? (Math.max(...leftOfIva.map((w) => w.right)) + iva.x) / 2 : iva.x - 15;
  const afterPct = headerRow.words.filter((w) => w.x > pct.right && w.right <= saleHeaderLeft);
  const taxRight = afterPct.length ? (pct.right + Math.min(...afterPct.map((w) => w.x))) / 2 : (pct.right + saleHeaderLeft) / 2;
  const beforeSale = headerRow.words.filter((w) => w.right <= saleHeaderLeft);
  const saleLeft = beforeSale.length ? (Math.max(...beforeSale.map((w) => w.right)) + saleHeaderLeft) / 2 : saleHeaderLeft - 5;

  return { taxLeft, taxRight, taxSplit: (center(iva) + center(pct)) / 2, saleLeft: Math.max(saleLeft, taxRight) };
}

type RowReading =
  | { kind: "text" }
  | { kind: "line"; line: Omit<InvoiceLine, "page"> }
  | { kind: "issue"; text: string; reason: string; partial: Omit<ProductLine, "page"> };

/** Interpreta una fila de producto con las columnas conocidas. */
export function readProductRow(row: TextRow, a: ColumnAnchors): RowReading {
  const words = row.words.filter((w) => w.text !== "$");
  const tax = words.filter((w) => center(w) >= a.taxLeft && center(w) < a.taxRight);
  const sale = words.filter((w) => center(w) >= a.saleLeft);
  const left = words.filter((w) => center(w) < a.taxLeft);
  // Sin cifras en IVA / % / precio de venta ni importes a la izquierda: texto (descripción partida, encabezado en varias líneas).
  const hasDigits = (w: Word) => /\d/.test(w.text);
  if (!tax.some(hasDigits) && !sale.some(hasDigits) && !left.some(isDecimalMoney)) return { kind: "text" };

  const text = joinWords(row.words);
  let vatText: string | undefined;
  let rateText: string | undefined;
  if (tax.length === 2) [vatText, rateText] = [tax[0].text, tax[1].text];
  else if (tax.length === 1) {
    if (center(tax[0]) < a.taxSplit) vatText = tax[0].text;
    else rateText = tax[0].text;
  }
  const rateBp = rateText !== undefined ? parseRate(rateText) : null;
  let vatCents = vatText !== undefined ? parseCopAmount(vatText) : null;
  const baseCents = sale.length === 1 ? parseCopAmount(sale[0].text) : null;
  // Tarifa 0 % sin valor de IVA impreso: el IVA es 0 por definición (no se inventa).
  if (vatCents === null && vatText === undefined && rateBp === 0) vatCents = 0;

  const description = joinWords(left);
  // Lo que sí se leyó de una fila incompleta (solo para mostrarla; no entra al cálculo).
  const partial = { description, rateBp: rateBp ?? undefined, vatCents: vatCents ?? undefined, baseCents: baseCents ?? undefined };
  const missing = [rateBp === null && "%", vatCents === null && "IVA", baseCents === null && "Precio unitario de venta"].filter(Boolean);
  if (tax.length > 2) return { kind: "issue", text, partial, reason: "La fila tiene más valores de los esperados en las columnas IVA y %." };
  if (sale.length > 1) return { kind: "issue", text, partial, reason: "La fila tiene más de un valor en «Precio unitario de venta»." };
  if (missing.length || rateBp === null || vatCents === null || baseCents === null) {
    return { kind: "issue", text, partial, reason: `No se pudo identificar: ${missing.join(", ")}.` };
  }
  return { kind: "line", line: { description, rateBp, vatCents, baseCents } };
}

interface TableResult {
  lines: InvoiceLine[];
  issues: LineIssue[];
  products: ProductLine[];
  /** Página y fila donde terminó la tabla (para buscar después los totales). */
  endPage: number;
}

function readTable(pages: PageRows[], start: { pi: number; ri: number }, isHeading: (r: TextRow) => boolean, titleKey: string): TableResult {
  const lines: InvoiceLine[] = [];
  const issues: LineIssue[] = [];
  // Filas de la tabla (sin pies ni títulos repetidos) y, por cada fila leída, su posición: para ubicar su descripción.
  const tablePages: PageRows[] = [];
  const found: { y: number; line?: InvoiceLine; product: ProductLine }[] = [];
  let anchors: ColumnAnchors | undefined;
  let endPage = pages.length - 1;

  outer: for (let pi = start.pi; pi < pages.length; pi++) {
    const { page, rows } = pages[pi];
    const kept: TextRow[] = [];
    tablePages.push({ page, rows: kept });
    for (let ri = pi === start.pi ? start.ri + 1 : 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const key = rowKey(row);
      if (FOOTER.test(rowText(row))) continue;
      if (isHeading(row)) {
        // Encabezados repetidos al inicio de una página de continuación.
        if (key === titleKey || CONTINUATION_HEADINGS.some((re) => re.test(key))) continue;
        endPage = pi;
        break outer;
      }
      kept.push(row);
      if (isHeaderRow(row)) {
        anchors = findAnchors(rows, ri) ?? anchors;
        continue;
      }
      if (!anchors) continue;
      const reading = readProductRow(row, anchors);
      if (reading.kind === "line") {
        const line = { page, ...reading.line };
        lines.push(line);
        found.push({ y: row.y, line, product: line });
      } else if (reading.kind === "issue") {
        issues.push({ page, text: reading.text, reason: reading.reason });
        found.push({ y: row.y, product: { page, ...reading.partial } });
      }
    }
  }
  if (!anchors) throw new InvoiceFormatError("No se encontraron las columnas IVA, % y «Precio unitario de venta» en «Detalles de Productos».");

  // Solo la columna «Descripción» (unida si ocupa varias líneas); sin ella, el texto a la izquierda del IVA.
  const descriptions = readProductDescriptions(tablePages);
  const products = found.map(({ y, line, product }) => {
    const description = descriptions.get(productRowKey(product.page, y)) || product.description;
    if (line) line.description = description;
    return { ...product, description };
  });
  return { lines, issues, products, endPage };
}

// ---------------------------------------------------------------------------
// Datos Totales
// ---------------------------------------------------------------------------

interface Totals {
  subtotalCents?: number;
  grossTotalCents?: number;
  vatCents?: number;
}

/**
 * La sección tiene dos cajas lado a lado (la izquierda queda vacía cuando la
 * factura es en pesos). Por cada etiqueta se toma el valor de la caja más a
 * la derecha que lo tenga.
 */
function readTotals(pages: PageRows[], fromPage: number, isHeading: (r: TextRow) => boolean): Totals {
  for (let pi = fromPage; pi < pages.length; pi++) {
    const rows = pages[pi].rows;
    const start = rows.findIndex((r) => /^datos totales/.test(rowKey(r)));
    if (start === -1) continue;
    const region: TextRow[] = [];
    for (let i = start + 1; i < rows.length && !isHeading(rows[i]); i++) region.push(rows[i]);
    const starts = region
      .flatMap((r) => r.words)
      .filter((w) => /^subtotal$/i.test(w.text))
      .map((w) => w.x)
      .sort((a, b) => a - b);
    if (starts.length === 0) return {};

    const found: Record<keyof Totals, number | undefined> = { subtotalCents: undefined, grossTotalCents: undefined, vatCents: undefined };
    for (const row of region) {
      starts.forEach((x0, k) => {
        const x1 = starts[k + 1];
        const seg = row.words.filter((w) => w.x >= x0 - 4 && (x1 === undefined || w.x < x1 - 4));
        const money = seg.filter(isMoney);
        const value = money.length ? parseCopAmount(money[money.length - 1].text) : null;
        if (value === null) return;
        const label = normalizeKey(joinWords(seg.filter((w) => !isMoney(w) && w.text !== "$")));
        const field: keyof Totals | undefined = label === "subtotal" ? "subtotalCents" : label.startsWith("total bruto") ? "grossTotalCents" : label === "iva" ? "vatCents" : undefined;
        if (field) found[field] = value; // las cajas se recorren de izquierda a derecha: gana la derecha
      });
    }
    return found;
  }
  return {};
}

// ---------------------------------------------------------------------------

export function parseInvoice(doc: PdfDocumentText): ParsedInvoice {
  const pages: PageRows[] = doc.pages.map((p) => ({ page: p.pageNumber, rows: buildRows(p.items) }));
  if (!pages.some((p) => p.rows.length > 0)) {
    throw new InvoiceFormatError("El PDF no contiene texto (posiblemente es una imagen escaneada). No se usa OCR.");
  }

  let details: { pi: number; ri: number } | undefined;
  for (let pi = 0; pi < pages.length && !details; pi++) {
    const ri = pages[pi].rows.findIndex((r) => DETAILS_HEADING.test(rowKey(r)));
    if (ri !== -1) details = { pi, ri };
  }
  if (!details) throw new InvoiceFormatError("No se encontró la sección «Detalles de Productos».");

  const headingHeight = rowHeight(pages[details.pi].rows[details.ri]);
  const isHeading = (r: TextRow) => rowHeight(r) >= headingHeight * 0.9 && !FOOTER.test(rowText(r));

  const firstRows = pages[0].rows;
  const documentType = detectTitle(firstRows);

  // Sección del emisor: desde su título hasta el siguiente título.
  const issuer: TextRow[] = [];
  for (const p of pages) {
    const start = p.rows.findIndex((r) => ISSUER_HEADING.test(rowKey(r)));
    if (start === -1) continue;
    for (let i = start + 1; i < p.rows.length && !isHeading(p.rows[i]); i++) issuer.push(p.rows[i]);
    break;
  }
  const issuerStart = firstRows.findIndex((r) => ISSUER_HEADING.test(rowKey(r)));
  const documentRows = issuerStart === -1 ? firstRows : firstRows.slice(0, issuerStart);

  const nitText = findField(issuer, NIT_LABEL) ?? qrField(pages, "NitFac") ?? qrField(pages, "NitOFE");
  const supplierNit = nitText ? normalizeNit(nitText) : "";
  if (!supplierNit) throw new InvoiceFormatError("No se encontró el NIT del emisor.");
  const supplierName = findField(issuer, NAME_LABEL) ?? findField(issuer, TRADE_NAME_LABEL) ?? "";
  const invoiceNumber = findField(documentRows, NUMBER_LABEL) ?? qrField(pages, "NumFac");

  const table = readTable(pages, details, isHeading, normalizeKey(documentType ?? ""));
  const totals = readTotals(pages, details.pi, isHeading);
  const qrVat = qrField(pages, "ValIva");

  return {
    pageCount: doc.pageCount,
    documentType: documentType ?? "Documento sin título",
    invoiceNumber: invoiceNumber || undefined,
    supplierNit,
    supplierName,
    lines: table.lines,
    lineIssues: table.issues,
    products: table.products,
    subtotalCents: totals.subtotalCents,
    grossTotalCents: totals.grossTotalCents,
    invoiceVatCents: totals.vatCents ?? (qrVat !== undefined ? (parseDotDecimal(qrVat) ?? undefined) : undefined),
  };
}
