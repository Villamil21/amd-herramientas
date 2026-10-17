import type { PdfDocumentText } from "../../../bank-analysis/shared/pdf/pdfTypes";
import { buildRows } from "../../../bank-analysis/shared/pdf/rows";
import { findField, ISSUER_HEADING, parseInvoice, rowKey, type PageRows } from "../../../taxes/invoice-vat/parser/invoiceParser";
import { parseCopAmount } from "../../../taxes/invoice-vat/parser/amounts";
import { parseWithholdingDocument } from "../../../taxes/withholding/parser/withholdingParser";
import { readBuyer, readCufe } from "../../puc-codes/parser/pucParser";
import { normalizeKey } from "../../../../utils/text";
import type { ParsedPurchase, PurchaseLine } from "../../../../types/purchases";

/**
 * Lector de facturas y notas crédito electrónicas (representación gráfica DIAN) para Compras, costos y exógena.
 *
 * Combina los lectores que ya existen y no los duplica:
 *  - IVA de compras: título, emisor, número, filas de «Detalles de Productos» (descripción, IVA, % y «Precio unitario de venta»,
 *    que es el importe de la línea) y Datos Totales.
 *  - Retención en la fuente: tabla completa (código, U/M, cantidad, precio, descuento y recargo), «Rete fuente», fecha de emisión,
 *    tipo de contribuyente y régimen del EMISOR.
 *  - Códigos PUC: adquiriente (NIT y nombre) y CUFE / CUDE.
 *
 * Lo que el PDF no dice con claridad queda sin definir: nunca se inventa un dato.
 */

/** Clave del número de documento: sin espacios ni guiones, en mayúsculas. */
export const numberKey = (number: string | undefined) => (number ?? "").replace(/[\s-]/g, "").toUpperCase();

/** «1,00» → 1 · «1.250,50» → 1250,5 · «12» → 12. Sin formato reconocible: undefined. */
export function parseQuantity(text: string | undefined): number | undefined {
  const t = (text ?? "").trim();
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(t)) return undefined;
  const value = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

type Columns = Record<"code" | "unit" | "quantity" | "unitPrice" | "discount" | "surcharge", number>;

/** Posición de cada columna de la tabla completa, por el texto de su encabezado. */
function columnIndexes(columns: string[]): Columns {
  const find = (re: RegExp) => columns.findIndex((c) => re.test(normalizeKey(c)));
  const sale = columns.findIndex((c) => /^precio unitario de venta/.test(normalizeKey(c)));
  return {
    code: find(/^codigo/),
    unit: find(/^u\/m/),
    quantity: find(/^cantidad/),
    unitPrice: columns.findIndex((c, i) => /^precio unitario$/.test(normalizeKey(c)) && i !== sale),
    discount: find(/^descuento/),
    surcharge: find(/^recargo/),
  };
}

/** «Tipo de Documento» de los datos del emisor / vendedor, si la factura lo trae (suele faltar cuando el emisor es persona jurídica). */
export function readIssuerDocType(pages: PageRows[]): string | undefined {
  for (const p of pages) {
    const start = p.rows.findIndex((r) => ISSUER_HEADING.test(rowKey(r)));
    if (start === -1) continue;
    const section = [];
    for (let i = start + 1; i < p.rows.length; i++) {
      if (/^datos (del|de la|de los) /.test(rowKey(p.rows[i]))) break;
      section.push(p.rows[i]);
    }
    return findField(section, /^tipo de documento\s*:/i);
  }
  return undefined;
}

/**
 * IVA y % vacíos a la vez = IVA cero (la plantilla no imprime nada cuando no hay impuesto). Un valor presente pero ilegible o
 * contradictorio no cae aquí: sigue como incidencia para que se revise.
 */
export const isEmptyVat = (p: { emptyTax?: boolean; rateBp?: number; vatCents?: number; baseCents?: number }) =>
  p.emptyTax === true && p.rateBp === undefined && p.vatCents === undefined && p.baseCents !== undefined;

export function parsePurchaseDocument(doc: PdfDocumentText): ParsedPurchase {
  const invoice = parseInvoice(doc);
  const withholding = parseWithholdingDocument(doc);
  const pages: PageRows[] = doc.pages.map((p) => ({ page: p.pageNumber, rows: buildRows(p.items) }));
  const firstRows = pages[0]?.rows ?? [];
  const issuerStart = firstRows.findIndex((r) => ISSUER_HEADING.test(rowKey(r)));
  const documentRows = issuerStart === -1 ? firstRows : firstRows.slice(0, issuerStart);
  const buyer = readBuyer(pages);
  // La tabla completa y la de IVA leen las mismas filas en el mismo orden: solo se unen si tienen la misma cantidad.
  const table = withholding.products;
  const merge = table.rows.length === invoice.products.length;
  const at = columnIndexes(table.columns);
  const cell = (i: number, col: number) => (merge && col >= 0 ? table.rows[i]?.cells[col]?.trim() : undefined);
  const money = (text: string | undefined) => (text ? (parseCopAmount(text) ?? undefined) : undefined);

  const lines: PurchaseLine[] = invoice.products.map((p, i) => {
    const description = p.description.trim();
    const emptyVat = isEmptyVat(p);
    const line: PurchaseLine = {
      index: i,
      page: p.page,
      code: cell(i, at.code) ?? "",
      description,
      unit: cell(i, at.unit) ?? "",
      quantity: parseQuantity(cell(i, at.quantity)),
      unitPriceCents: money(cell(i, at.unitPrice)),
      discountCents: money(cell(i, at.discount)),
      surchargeCents: money(cell(i, at.surcharge)),
      baseCents: p.baseCents,
      vatCents: emptyVat ? 0 : p.vatCents,
      rateBp: emptyVat ? 0 : p.rateBp,
    };
    const missing = [!description && "la descripción", p.baseCents === undefined && "el «Precio unitario de venta»"].filter(Boolean);
    if ((p.issue && !emptyVat) || missing.length) {
      line.issue = p.issue ?? `No se pudo identificar ${missing.join(" ni ")}.`;
      line.detectedText = p.description;
    }
    return line;
  });

  const issueDate = withholding.issueDate;
  return {
    pageCount: invoice.pageCount,
    title: invoice.documentType,
    number: invoice.invoiceNumber,
    cufe: readCufe(documentRows, pages),
    issueDate,
    issuer: {
      nit: invoice.supplierNit,
      name: invoice.supplierName,
      personType: invoice.issuer?.personType,
      address: invoice.issuer?.address,
      country: invoice.issuer?.country,
      department: invoice.issuer?.department,
      city: invoice.issuer?.city,
      phone: invoice.issuer?.phone,
      email: invoice.issuer?.email,
      fiscalCodes: withholding.fiscalCodes,
      fiscalText: withholding.fiscalText,
      docTypeText: readIssuerDocType(pages),
    },
    buyerNit: buyer.nit,
    buyerName: buyer.name,
    lines,
    subtotalCents: invoice.subtotalCents ?? withholding.subtotalCents,
    grossTotalCents: invoice.grossTotalCents,
    vatCents: invoice.invoiceVatCents,
    retefuenteCents: withholding.retefuenteCents,
    totalCents: invoice.netTotalCents,
  };
}
