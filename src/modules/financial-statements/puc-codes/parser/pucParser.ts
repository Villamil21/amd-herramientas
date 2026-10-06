import type { PdfDocumentText } from "../../../bank-analysis/shared/pdf/pdfTypes";
import { buildRows, type TextRow } from "../../../bank-analysis/shared/pdf/rows";
import { findField, ISSUER_HEADING, parseInvoice, qrField, rowKey, rowText, type PageRows } from "../../../taxes/invoice-vat/parser/invoiceParser";
import { NO_TITLE } from "../../../taxes/invoice-vat/services/analysis";
import { parseIssueDate } from "../../../taxes/withholding/parser/withholdingParser";
import type { ParsedPucDocument, PucProduct } from "../types";

/**
 * Lector de facturas y notas electrónicas (representación gráfica DIAN) para
 * Códigos PUC por factura. Reutiliza el lector de IVA de compras (título,
 * emisor, número, tabla «Detalles de Productos» en varias páginas y Datos
 * Totales) y de él toma solo lo que este módulo usa: Descripción y «Precio
 * unitario de venta» de cada fila y el «Total Bruto Factura». Agrega la fecha
 * de emisión y el CUFE / CUDE (para detectar duplicados).
 *
 * Una fila es válida con descripción y precio: que no se haya podido leer su
 * IVA o su % no le importa a este módulo.
 */

export { NO_TITLE };

const ISSUE_DATE_LABEL = /^fecha( de)? (emisi[oó]n|expedici[oó]n|generaci[oó]n)\s*:/i;
const CUFE_LABEL = /\b(cufe|cude)\b/;
const HEX = /^[0-9a-f]+$/i;
/** SHA-384 en hexadecimal (96 caracteres); se admite desde SHA-256 por si la plantilla cambia. */
const validCufe = (value: string) => value.length >= 64 && value.length <= 128 && HEX.test(value);

/**
 * CUFE / CUDE de «Datos del Documento»: el valor va junto a su etiqueta o en
 * las líneas siguientes (puede partirse en dos). Respaldo: el texto del QR.
 */
export function readCufe(documentRows: TextRow[], pages: PageRows[]): string | undefined {
  const index = documentRows.findIndex((r) => CUFE_LABEL.test(rowKey(r)));
  if (index !== -1) {
    const sameRow = rowText(documentRows[index]).split(":").pop()!.replace(/\s/g, "");
    let value = HEX.test(sameRow) ? sameRow : "";
    for (let i = index + 1; i < documentRows.length && value.length < 96; i++) {
      const text = rowText(documentRows[i]).replace(/\s/g, "");
      if (!HEX.test(text)) break;
      value += text;
    }
    if (validCufe(value)) return value.toLowerCase();
  }
  const qr = qrField(pages, "CUFE") ?? qrField(pages, "CUDE");
  return qr && validCufe(qr) ? qr.toLowerCase() : undefined;
}

export function parsePucDocument(doc: PdfDocumentText): ParsedPucDocument {
  const invoice = parseInvoice(doc);
  const pages: PageRows[] = doc.pages.map((p) => ({ page: p.pageNumber, rows: buildRows(p.items) }));
  const firstRows = pages[0]?.rows ?? [];
  const issuerStart = firstRows.findIndex((r) => ISSUER_HEADING.test(rowKey(r)));
  const documentRows = issuerStart === -1 ? firstRows : firstRows.slice(0, issuerStart);

  // Las filas que el lector de IVA marcó con problema van, en el mismo orden, en `lineIssues` (con su texto original).
  let issueIndex = 0;
  const products: PucProduct[] = invoice.products.map((p, i) => {
    const detectedText = p.issue ? invoice.lineIssues[issueIndex++]?.text : undefined;
    const missing = [!p.description.trim() && "la descripción", p.baseCents === undefined && "el «Precio unitario de venta»"].filter(Boolean);
    const product: PucProduct = { page: p.page, row: i + 1, description: p.description.trim(), priceCents: p.baseCents };
    if (missing.length) {
      product.issue = `No se pudo identificar ${missing.join(" ni ")}.`;
      product.detectedText = detectedText ?? p.description;
    }
    return product;
  });

  return {
    pageCount: invoice.pageCount,
    title: invoice.documentType,
    number: invoice.invoiceNumber,
    cufe: readCufe(documentRows, pages),
    issueDate: parseIssueDate(findField(documentRows, ISSUE_DATE_LABEL) ?? qrField(pages, "FecFac")),
    issuerNit: invoice.supplierNit,
    issuerName: invoice.supplierName,
    products,
    grossTotalCents: invoice.grossTotalCents,
  };
}
