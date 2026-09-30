import type { PdfDocumentText } from "../../../bank-analysis/shared/pdf/pdfTypes";
import { buildRows, joinWords, type TextRow } from "../../../bank-analysis/shared/pdf/rows";
import { normalizeKey } from "../../../../utils/text";
import {
  cells,
  CONTINUATION_HEADINGS,
  DETAILS_HEADING,
  detectTitle,
  findField,
  FOOTER,
  InvoiceFormatError,
  isMoney,
  ISSUER_HEADING,
  NAME_LABEL,
  NIT_LABEL,
  normalizeNit,
  NUMBER_LABEL,
  qrField,
  rowHeight,
  rowKey,
  rowText,
  TRADE_NAME_LABEL,
  type PageRows,
} from "../../invoice-vat/parser/invoiceParser";
import { parseCopAmount } from "../../invoice-vat/parser/amounts";
import { fiscalCodes } from "../services/fiscal";
import type { ParsedDocument } from "../types";
import { readProductTable } from "./productTable";

/**
 * Lector de facturas y notas electrónicas (representación gráfica DIAN) para
 * Retención en la fuente. Reutiliza los criterios del análisis de IVA
 * (título, emisor, número, secciones por encabezados) y agrega: fecha de
 * emisión, tipo de contribuyente y régimen / responsabilidad fiscal del
 * EMISOR (nunca del comprador), la tabla de productos completa y la
 * «Rete fuente» de Datos Totales.
 *
 * No depende del proveedor, del número de páginas ni de posiciones fijas.
 */

const ISSUE_DATE_LABEL = /^fecha( de)? (emisi[oó]n|expedici[oó]n|generaci[oó]n)\s*:/i;
const TAXPAYER_LABEL = /^tipo( de)? (contribuyente|persona)\s*:/i;
/** Régimen fiscal, responsabilidad tributaria / fiscal, obligaciones… (cualquier variante). */
const FISCAL_LABEL = /^(r[eé]gimen|responsabilidad(es)?|obligaci[oó]n(es)?)\b[^:]{0,40}:/i;

/** "31/01/2026", "31-01-2026" o "2026-01-31" → "2026-01-31". */
export function parseIssueDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const dmy = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(text);
  const ymd = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  const [y, m, d] = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y) return undefined;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Pares «Etiqueta: valor» de régimen / responsabilidad del emisor. */
function fiscalFields(rows: TextRow[]): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const row of rows) {
    const cs = cells(row);
    for (let i = 0; i < cs.length; i++) {
      const m = FISCAL_LABEL.exec(cs[i]);
      if (!m) continue;
      const value = cs[i].slice(m[0].length).trim() || (cs[i + 1] && !cs[i + 1].endsWith(":") ? cs[i + 1].trim() : "");
      if (value) out.push({ label: m[0].replace(/\s*:$/, "").trim(), value });
    }
  }
  return out;
}

interface Totals {
  subtotalCents?: number;
  retefuenteCents?: number;
}

const RETEFUENTE = /^(rete ?fuente|retencion en la fuente|retefuente renta)$/;

/**
 * Datos Totales: dos cajas lado a lado (la izquierda vacía cuando la factura
 * es en pesos). Por cada etiqueta gana el valor de la caja más a la derecha.
 */
function readTotals(pages: PageRows[], isHeading: (r: TextRow) => boolean): Totals {
  for (const { rows } of pages) {
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
    const found: Totals = {};
    for (const row of region) {
      starts.forEach((x0, k) => {
        const x1 = starts[k + 1];
        const seg = row.words.filter((w) => w.x >= x0 - 4 && (x1 === undefined || w.x < x1 - 4));
        const money = seg.filter(isMoney);
        const value = money.length ? parseCopAmount(money[money.length - 1].text) : null;
        if (value === null) return;
        const label = normalizeKey(joinWords(seg.filter((w) => !isMoney(w) && w.text !== "$")));
        if (label === "subtotal") found.subtotalCents = value;
        else if (RETEFUENTE.test(label)) found.retefuenteCents = value;
      });
    }
    return found;
  }
  return {};
}

export function parseWithholdingDocument(doc: PdfDocumentText): ParsedDocument {
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
  const title = detectTitle(firstRows);
  const titleKey = normalizeKey(title ?? "");

  // Sección del emisor / vendedor: desde su título hasta el siguiente título.
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

  const fields = fiscalFields(issuer);
  // Sin etiquetas reconocibles: se buscan códigos en todo el bloque del emisor.
  const codes = fields.length ? fiscalCodes(fields.map((f) => f.value).join(" ")) : fiscalCodes(issuer.map(rowText).join(" "));

  // Tabla de productos: filas desde el título de la sección hasta la siguiente sección.
  const tablePages: PageRows[] = [];
  outer: for (let pi = details.pi; pi < pages.length; pi++) {
    const { page, rows } = pages[pi];
    const kept: TextRow[] = [];
    for (let ri = pi === details.pi ? details.ri + 1 : 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (FOOTER.test(rowText(row))) continue;
      if (isHeading(row)) {
        const key = rowKey(row);
        if (key === titleKey || CONTINUATION_HEADINGS.some((re) => re.test(key))) continue;
        tablePages.push({ page, rows: kept });
        break outer;
      }
      kept.push(row);
    }
    tablePages.push({ page, rows: kept });
  }

  const totals = readTotals(pages.slice(details.pi), isHeading);
  const number = findField(documentRows, NUMBER_LABEL) ?? qrField(pages, "NumFac");

  return {
    pageCount: doc.pageCount,
    title: title ?? "Documento sin título",
    number: number || undefined,
    issueDate: parseIssueDate(findField(documentRows, ISSUE_DATE_LABEL) ?? qrField(pages, "FecFac")),
    supplierNit,
    supplierName: findField(issuer, NAME_LABEL) ?? findField(issuer, TRADE_NAME_LABEL) ?? "",
    taxpayerType: findField(issuer, TAXPAYER_LABEL),
    fiscalText: fields.length ? fields.map((f) => `${f.label}: ${f.value}`).join(" · ") : undefined,
    fiscalCodes: codes,
    subtotalCents: totals.subtotalCents,
    retefuenteCents: totals.retefuenteCents,
    products: readProductTable(tablePages),
  };
}
