import type { Supplier } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";
import { formatCop, formatRateBp } from "../parser/amounts";
import type { BaseVat, DocumentTypeSummary, FileResult, Incident, InvoiceReport, InvoiceRow, NameMismatch, ParsedInvoice, PendingSupplier, RateBp } from "../types";

export interface ReportOptions {
  /** Sumar también los posibles duplicados (por defecto se excluyen del resumen). */
  includeDuplicates?: boolean;
  /** Diferencias de razón social que el usuario decidió mantener: `${nit}|${normalizeKey(nombre)}`. */
  keptNames?: ReadonlySet<string>;
}

export const nameKey = (nit: string, name: string) => `${nit}|${normalizeKey(name)}`;

const zero = (): BaseVat => ({ baseCents: 0, vatCents: 0 });
const add = (t: BaseVat, baseCents: number, vatCents: number) => {
  t.baseCents += baseCents;
  t.vatCents += vatCents;
};

function mergeRates(target: (BaseVat & { rateBp: RateBp })[], rateBp: RateBp, baseCents: number, vatCents: number) {
  const found = target.find((r) => r.rateBp === rateBp);
  if (found) add(found, baseCents, vatCents);
  else target.push({ rateBp, baseCents, vatCents });
}

/** Totales por tarifa de una factura (suma de sus líneas; la base es «Precio unitario de venta»). */
function figures(invoice: ParsedInvoice) {
  const f = { base5: 0, vat5: 0, base19: 0, vat19: 0, base0: 0, detailVatCents: 0, otherRates: [] as (BaseVat & { rateBp: RateBp })[] };
  for (const l of invoice.lines) {
    f.detailVatCents += l.vatCents;
    if (l.rateBp === 500) {
      f.base5 += l.baseCents;
      f.vat5 += l.vatCents;
    } else if (l.rateBp === 1900) {
      f.base19 += l.baseCents;
      f.vat19 += l.vatCents;
    } else if (l.rateBp === 0) {
      f.base0 += l.baseCents;
    } else mergeRates(f.otherRates, l.rateBp, l.baseCents, l.vatCents);
  }
  return f;
}

const invoiceKey = (nit: string, number: string) => `${nit}|${number.replace(/[\s-]/g, "").toUpperCase()}`;

function parsedRow(fileName: string, invoice: ParsedInvoice, supplier: Supplier | undefined, duplicateOf: string | undefined): InvoiceRow {
  const f = figures(invoice);
  const issues: string[] = [];
  const notes: string[] = [];

  if (invoice.documentType === "Documento sin título") issues.push("No se encontró el título del documento.");
  if (!invoice.supplierName) issues.push("No se encontró la razón social del emisor.");
  if (invoice.lineIssues.length) {
    const n = invoice.lineIssues.length;
    issues.push(n === 1 ? "1 fila de productos no permite identificar %, IVA o precio unitario de venta." : `${n} filas de productos no permiten identificar %, IVA o precio unitario de venta.`);
  }
  if (invoice.lines.length === 0 && invoice.lineIssues.length === 0) issues.push("No se encontraron productos en «Detalles de Productos».");
  for (const r of f.otherRates) issues.push(`Se encontró una tarifa de IVA no configurada: ${formatRateBp(r.rateBp)}.`);
  if (supplier?.vatType === "service" && (f.base5 || f.vat5)) issues.push("Servicios al 5 % detectados: requieren clasificación en el resumen.");
  if (duplicateOf) issues.push(`Posible duplicado de «${duplicateOf}» (mismo NIT y número de factura).`);

  const bases = invoice.lines.reduce((s, l) => s + l.baseCents, 0);
  const references = [invoice.subtotalCents, invoice.grossTotalCents].filter((v): v is number => v !== undefined);
  if (references.length === 0) notes.push("No se encontró el subtotal del documento para validar las bases.");
  else if (!references.includes(bases) && invoice.lines.length > 0) {
    issues.push(`La suma de bases por línea (${formatCop(bases)}) no coincide con el subtotal del documento (${formatCop(references[0])}).`);
  }

  if (invoice.invoiceVatCents === undefined) notes.push("No se encontró el IVA total del documento para validar.");
  else {
    const diff = invoice.invoiceVatCents - f.detailVatCents;
    if (diff !== 0) {
      const text = `IVA según detalle ${formatCop(f.detailVatCents)} · IVA según total factura ${formatCop(invoice.invoiceVatCents)} · Diferencia por validar ${formatCop(Math.abs(diff))}.`;
      // Hasta un peso por línea gravada se considera redondeo del documento (informativo).
      const taxedLines = invoice.lines.filter((l) => l.rateBp > 0).length;
      if (Math.abs(diff) <= Math.max(1, taxedLines) * 100) notes.push(text);
      else issues.push(text);
    }
  }

  return {
    fileName,
    status: issues.length ? "review" : supplier ? "processed" : "pending-supplier",
    documentType: invoice.documentType,
    documentTypeKey: normalizeKey(invoice.documentType),
    invoiceNumber: invoice.invoiceNumber,
    supplierNit: invoice.supplierNit,
    supplierName: invoice.supplierName,
    vatType: supplier?.vatType,
    pageCount: invoice.pageCount,
    lineCount: invoice.lines.length,
    ...f,
    invoiceVatCents: invoice.invoiceVatCents,
    subtotalCents: invoice.subtotalCents ?? invoice.grossTotalCents,
    duplicateOf,
    issues,
    notes,
    lineIssues: invoice.lineIssues,
    products: invoice.products,
  };
}

function failedRow(fileName: string, status: "incompatible" | "error", message: string): InvoiceRow {
  return { fileName, status, lineCount: 0, base5: 0, vat5: 0, base19: 0, vat19: 0, base0: 0, otherRates: [], detailVatCents: 0, issues: [message], notes: [], lineIssues: [], products: [] };
}

/** El nombre más frecuente entre las facturas de un NIT (en empate, el primero). */
function mostFrequent(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/**
 * Cruza las facturas leídas con los proveedores y arma tabla, pendientes y
 * resumen. Es una función pura: al crear o editar un proveedor basta con
 * volver a llamarla (no se releen los PDF).
 */
export function buildReport(results: FileResult[], suppliers: Supplier[], options: ReportOptions = {}): InvoiceReport {
  const byNit = new Map(suppliers.map((s) => [s.nit, s]));
  const seen = new Map<string, string>();

  const rows = results.map((r) => {
    if (r.kind !== "parsed") return failedRow(r.fileName, r.kind, r.message);
    const { invoice } = r;
    let duplicateOf: string | undefined;
    if (invoice.invoiceNumber) {
      const key = invoiceKey(invoice.supplierNit, invoice.invoiceNumber);
      duplicateOf = seen.get(key);
      if (!duplicateOf) seen.set(key, r.fileName);
    }
    return parsedRow(r.fileName, invoice, byNit.get(invoice.supplierNit), duplicateOf);
  });
  const parsed = rows.filter((r) => r.supplierNit);

  // Proveedores sin registrar: uno por NIT, sin importar cuántas facturas tenga.
  const pendingNames = new Map<string, string[]>();
  for (const r of parsed) {
    if (r.vatType) continue;
    const list = pendingNames.get(r.supplierNit!) ?? [];
    list.push(r.supplierName ?? "");
    pendingNames.set(r.supplierNit!, list);
  }
  const pendingSuppliers: PendingSupplier[] = [...pendingNames.entries()].map(([nit, names]) => ({ nit, name: mostFrequent(names.filter(Boolean)), invoiceCount: names.length }));

  // Razón social distinta a la registrada para un NIT existente.
  const mismatches = new Map<string, NameMismatch>();
  for (const r of parsed) {
    const s = byNit.get(r.supplierNit!);
    if (!s || !r.supplierName || normalizeKey(r.supplierName) === normalizeKey(s.businessName)) continue;
    const key = nameKey(s.nit, r.supplierName);
    if (options.keptNames?.has(key)) continue;
    const m = mismatches.get(key);
    if (m) m.invoiceCount++;
    else mismatches.set(key, { supplierId: s.id, nit: s.nit, vatType: s.vatType, storedName: s.businessName, invoiceName: r.supplierName, invoiceCount: 1 });
  }

  const summaries: DocumentTypeSummary[] = [];
  if (pendingSuppliers.length === 0) {
    for (const r of parsed) {
      if (!r.vatType || (r.duplicateOf && !options.includeDuplicates)) continue;
      let s = summaries.find((x) => x.documentTypeKey === r.documentTypeKey);
      if (!s) {
        s = { documentType: r.documentType!, documentTypeKey: r.documentTypeKey!, invoiceCount: 0, purchases5: zero(), purchases19: zero(), services19: zero(), zeroBaseCents: 0, services5: zero(), otherRates: [] };
        summaries.push(s);
      }
      s.invoiceCount++;
      if (r.vatType === "purchase") {
        add(s.purchases5, r.base5, r.vat5);
        add(s.purchases19, r.base19, r.vat19);
      } else {
        add(s.services5, r.base5, r.vat5);
        add(s.services19, r.base19, r.vat19);
      }
      s.zeroBaseCents += r.base0;
      for (const o of r.otherRates) mergeRates(s.otherRates, o.rateBp, o.baseCents, o.vatCents);
    }
  }

  const incidents: Incident[] = [];
  for (const r of rows) {
    const type = r.status === "incompatible" ? "No compatible" : r.status === "error" ? "Error" : "Requiere revisión";
    for (const issue of r.issues) incidents.push({ fileName: r.fileName, type, detail: issue });
    for (const li of r.lineIssues) incidents.push({ fileName: r.fileName, type: "Fila no interpretable", detail: `Página ${li.page}: ${li.text} — ${li.reason}` });
    for (const note of r.notes) incidents.push({ fileName: r.fileName, type: "Información", detail: note });
  }

  const count = (status: InvoiceRow["status"]) => rows.filter((r) => r.status === status).length;
  return {
    rows,
    stats: {
      files: rows.length,
      processed: count("processed"),
      review: count("review"),
      pending: count("pending-supplier"),
      failed: count("incompatible") + count("error"),
      suppliers: new Set(parsed.map((r) => r.supplierNit)).size,
      newSuppliers: pendingSuppliers.length,
      documentTypes: new Set(parsed.map((r) => r.documentTypeKey)).size,
      duplicates: parsed.filter((r) => r.duplicateOf).length,
    },
    pendingSuppliers,
    nameMismatches: [...mismatches.values()],
    summaries,
    incidents,
  };
}
