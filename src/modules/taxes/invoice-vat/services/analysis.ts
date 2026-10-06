import type { Supplier } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";
import { formatCop, formatRateBp } from "../parser/amounts";
import type {
  BaseVat,
  Decisions,
  DocCategory,
  DocDecision,
  FileResult,
  Incident,
  InvoiceLine,
  InvoiceReport,
  InvoiceRow,
  NameMismatch,
  ParsedInvoice,
  PendingSupplier,
  ProductLine,
  RateBp,
  RowProblem,
  TitleRule,
  UnknownTitle,
  VatSummaryData,
} from "../types";

export interface ReportOptions {
  /** Decisiones del usuario por archivo (tarifa de una fila, confirmar, excluir, incluir duplicado). */
  decisions?: Decisions;
  /** Diferencias de razón social que el usuario decidió mantener: `${nit}|${normalizeKey(nombre)}`. */
  keptNames?: ReadonlySet<string>;
}

export const nameKey = (nit: string, name: string) => `${nit}|${normalizeKey(name)}`;

export const NO_TITLE = "Documento sin título";

/** Problemas que el usuario puede aceptar con «Confirmar interpretación». */
export const CONFIRMABLE: ReadonlySet<RowProblem["code"]> = new Set(["supplier-name", "base-mismatch", "vat-mismatch"]);

const zero = (): BaseVat => ({ baseCents: 0, vatCents: 0 });
const add = (t: BaseVat, baseCents: number, vatCents: number) => {
  t.baseCents += baseCents;
  t.vatCents += vatCents;
};
const sum = (lines: InvoiceLine[], key: "baseCents" | "vatCents") => lines.reduce((s, l) => s + l[key], 0);
const rows = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", String(n)));

function mergeRates(target: (BaseVat & { rateBp: RateBp })[], rateBp: RateBp, baseCents: number, vatCents: number) {
  const found = target.find((r) => r.rateBp === rateBp);
  if (found) add(found, baseCents, vatCents);
  else target.push({ rateBp, baseCents, vatCents });
}

/** Totales por tarifa de un documento (suma de sus líneas; la base es «Precio unitario de venta»). */
function figures(lines: InvoiceLine[]) {
  const f = { base5: 0, vat5: 0, base19: 0, vat19: 0, base0: 0, detailVatCents: 0, otherRates: [] as (BaseVat & { rateBp: RateBp })[] };
  for (const l of lines) {
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

/** Hasta un peso por línea se considera redondeo del documento (solo para decidir el 0 % automático). */
const rounding = (lineCount: number) => Math.max(1, lineCount) * 100;

/**
 * Diferencia de conciliación (calculado vs. documento) que se trata como
 * redondeo: hasta $50 COP no genera alerta ni pendiente. Solo aplica a
 * diferencias monetarias; no oculta ningún otro problema del documento.
 */
export const ROUNDING_TOLERANCE_CENTS = 5_000;
export const isRounding = (calculatedCents: number, documentCents: number) => Math.abs(calculatedCents - documentCents) <= ROUNDING_TOLERANCE_CENTS;

const references = (invoice: ParsedInvoice) => [invoice.subtotalCents, invoice.grossTotalCents].filter((v): v is number => v !== undefined);

interface Interpretation {
  /** Líneas que suman (leídas, 0 % automático o tarifa manual). */
  lines: InvoiceLine[];
  /** Todas las filas con su interpretación final, en el orden del PDF. */
  products: ProductLine[];
  /** Índices de las filas que siguen sin tarifa. */
  pending: number[];
  autoZero: number;
  manual: number;
  ignored: number;
}

const complete = (p: ProductLine): p is ProductLine & InvoiceLine => !p.issue && p.rateBp !== undefined && p.vatCents !== undefined && p.baseCents !== undefined;

/**
 * Interpretación final de las filas de «Detalle de productos».
 *
 * Una fila con IVA y % vacíos se toma como 0 % solo si no hay ambigüedad: se
 * leyó su «Precio unitario de venta», el IVA de las demás líneas ya explica
 * el IVA total del documento (no hay IVA para ella) y, sumando su precio, las
 * bases concilian con el subtotal. Si algo no cuadra queda para revisión y el
 * usuario puede definir la tarifa o ignorar la fila. El PDF no se modifica.
 */
export function interpretLines(invoice: ParsedInvoice, decision: DocDecision = {}): Interpretation {
  const products = invoice.products.map((p) => ({ ...p }));
  const lines: (InvoiceLine | undefined)[] = products.map(() => undefined);
  const candidates: number[] = [];
  const pending: number[] = [];
  let manual = 0;
  let ignored = 0;

  products.forEach((p, i) => {
    if (complete(p)) {
      lines[i] = { page: p.page, description: p.description, rateBp: p.rateBp, vatCents: p.vatCents, baseCents: p.baseCents };
      return;
    }
    const choice = decision.lines?.[i];
    if (choice === "ignore") {
      p.origin = "ignored";
      ignored++;
    } else if (choice !== undefined && p.baseCents !== undefined) {
      // Tarifa definida por el usuario: el IVA es el impreso o, si la celda está vacía, base × tarifa.
      const vatCents = p.vatCents ?? Math.round((p.baseCents * choice) / 10_000);
      Object.assign(p, { rateBp: choice, vatCents, origin: "manual" });
      lines[i] = { page: p.page, description: p.description, rateBp: choice, vatCents, baseCents: p.baseCents };
      manual++;
    } else if (p.emptyTax && p.baseCents !== undefined && p.rateBp === undefined && p.vatCents === undefined) candidates.push(i);
    else pending.push(i);
  });

  let autoZero = 0;
  if (candidates.length) {
    const known = lines.filter((l): l is InvoiceLine => l !== undefined);
    const vatExplained = invoice.invoiceVatCents !== undefined && Math.abs(invoice.invoiceVatCents - sum(known, "vatCents")) <= rounding(known.filter((l) => l.rateBp > 0).length);
    const bases = sum(known, "baseCents") + candidates.reduce((s, i) => s + products[i].baseCents!, 0);
    const basesReconcile = references(invoice).some((r) => Math.abs(r - bases) <= rounding(known.length + candidates.length));
    if (vatExplained && basesReconcile) {
      for (const i of candidates) {
        const p = products[i];
        Object.assign(p, { rateBp: 0, vatCents: 0, origin: "auto-zero" });
        lines[i] = { page: p.page, description: p.description, rateBp: 0, vatCents: 0, baseCents: p.baseCents! };
      }
      autoZero = candidates.length;
    } else pending.push(...candidates);
  }

  return { lines: lines.filter((l): l is InvoiceLine => l !== undefined), products, pending: pending.sort((a, b) => a - b), autoZero, manual, ignored };
}

const invoiceKey = (nit: string, number: string) => `${nit}|${number.replace(/[\s-]/g, "").toUpperCase()}`;

function parsedRow(fileName: string, invoice: ParsedInvoice, supplier: Supplier | undefined, category: DocCategory | undefined, duplicateOf: string | undefined, decision: DocDecision): InvoiceRow {
  const reading = interpretLines(invoice, decision);
  const { lines } = reading;
  const f = figures(lines);
  const problems: RowProblem[] = [];
  const notes: string[] = [];
  const problem = (code: RowProblem["code"], text: string) => {
    // Lo que el usuario confirmó deja de bloquear y queda como información.
    if (decision.confirmed && CONFIRMABLE.has(code)) notes.push(`${text} Confirmado por el usuario.`);
    else problems.push({ code, text });
  };

  if (invoice.documentType === NO_TITLE) problem("title-missing", "No se encontró el título del documento.");
  if (!invoice.supplierName) problem("supplier-name", "No se encontró la razón social del emisor.");
  if (reading.pending.length) problem("lines", rows(reading.pending.length, "1 fila de productos no permite identificar la tarifa de IVA.", "# filas de productos no permiten identificar la tarifa de IVA."));
  if (invoice.products.length === 0) problem("no-products", "No se encontraron productos en «Detalles de Productos».");
  // Las Notas crédito suman todo en una sola fila: no dependen de la tarifa ni del tipo de proveedor.
  if (category !== "credit_note") {
    for (const r of f.otherRates) problem("other-rate", `Se encontró una tarifa de IVA no configurada: ${formatRateBp(r.rateBp)}.`);
    if (supplier?.vatType === "service" && (f.base5 || f.vat5)) problem("services-5", "Servicios al 5 % detectados: el resumen no tiene renglón para ellos.");
  }
  if (duplicateOf) {
    if (decision.includeDuplicate) notes.push(`Posible duplicado de «${duplicateOf}»: incluido por decisión del usuario.`);
    else problem("duplicate", `Posible duplicado de «${duplicateOf}» (mismo NIT y número de factura).`);
  }

  if (reading.autoZero) notes.push(rows(reading.autoZero, "1 fila sin IVA ni % se interpretó como 0 % (el documento no reporta IVA para ella).", "# filas sin IVA ni % se interpretaron como 0 % (el documento no reporta IVA para ellas)."));
  if (reading.manual) notes.push(rows(reading.manual, "1 fila con tarifa definida por el usuario.", "# filas con tarifa definida por el usuario."));
  if (reading.ignored) notes.push(rows(reading.ignored, "1 fila ignorada por decisión del usuario (no suma).", "# filas ignoradas por decisión del usuario (no suman)."));

  const bases = sum(lines, "baseCents");
  const refs = references(invoice);
  if (refs.length === 0) notes.push("No se encontró el subtotal del documento para validar las bases.");
  else if (!refs.some((r) => isRounding(bases, r)) && lines.length > 0) {
    problem("base-mismatch", `La suma de bases por línea (${formatCop(bases)}) no coincide con el subtotal del documento (${formatCop(refs[0])}).`);
  }

  if (invoice.invoiceVatCents === undefined) notes.push("No se encontró el IVA total del documento para validar.");
  else if (!isRounding(f.detailVatCents, invoice.invoiceVatCents)) {
    const diff = Math.abs(invoice.invoiceVatCents - f.detailVatCents);
    problem("vat-mismatch", `IVA según detalle ${formatCop(f.detailVatCents)} · IVA según total factura ${formatCop(invoice.invoiceVatCents)} · Diferencia por validar ${formatCop(diff)}.`);
  }

  const status: InvoiceRow["status"] = decision.excluded ? "excluded" : problems.length ? "review" : !category ? "pending-title" : !supplier?.vatType ? "pending-supplier" : "processed";
  return {
    fileName,
    status,
    documentType: invoice.documentType,
    documentTypeKey: normalizeKey(invoice.documentType),
    category,
    invoiceNumber: invoice.invoiceNumber,
    supplierNit: invoice.supplierNit,
    supplierName: invoice.supplierName,
    vatType: supplier?.vatType ?? undefined,
    pageCount: invoice.pageCount,
    lineCount: lines.length,
    ...f,
    invoiceVatCents: invoice.invoiceVatCents,
    subtotalCents: invoice.subtotalCents ?? invoice.grossTotalCents,
    duplicateOf,
    problems,
    issues: problems.map((p) => p.text),
    notes,
    pendingLines: reading.pending,
    products: reading.products,
  };
}

function failedRow(fileName: string, status: "incompatible" | "error", message: string, excluded: boolean): InvoiceRow {
  return {
    fileName,
    status: excluded ? "excluded" : status,
    lineCount: 0,
    base5: 0,
    vat5: 0,
    base19: 0,
    vat19: 0,
    base0: 0,
    otherRates: [],
    detailVatCents: 0,
    problems: [],
    issues: [message],
    notes: [],
    pendingLines: [],
    products: [],
  };
}

/** El nombre más frecuente entre las facturas de un NIT (en empate, el primero). */
function mostFrequent(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** Solo documentos validados: Facturas por renglón y Notas crédito en una sola fila. */
function summarize(rowsToSum: InvoiceRow[]): VatSummaryData {
  const invoices = { documentCount: 0, purchases5: zero(), purchases19: zero(), services19: zero(), zeroBaseCents: 0 };
  const notes = { documentCount: 0, baseCents: 0, vatCents: 0 };
  for (const r of rowsToSum) {
    if (r.status !== "processed") continue;
    if (r.category === "credit_note") {
      notes.documentCount++;
      // Todas las bases y todo el IVA de la nota, sin separar tarifa ni Compras / Servicios.
      add(notes, r.base0 + r.base5 + r.base19 + r.otherRates.reduce((s, o) => s + o.baseCents, 0), r.detailVatCents);
      continue;
    }
    invoices.documentCount++;
    if (r.vatType === "purchase") {
      add(invoices.purchases5, r.base5, r.vat5);
      add(invoices.purchases19, r.base19, r.vat19);
    } else add(invoices.services19, r.base19, r.vat19);
    invoices.zeroBaseCents += r.base0;
  }
  return { invoices, notes };
}

/** Documentos que requieren intervención del usuario. */
export const needsAttention = (r: InvoiceRow) => r.status !== "processed" && r.status !== "excluded";

/**
 * Cruza los documentos leídos con los proveedores, la clasificación de
 * títulos y las decisiones del usuario, y arma tabla, pendientes y resumen.
 * Es una función pura: al resolver un pendiente basta con volver a llamarla
 * (no se releen los PDF).
 */
export function buildReport(results: FileResult[], suppliers: Supplier[], titles: TitleRule[], options: ReportOptions = {}): InvoiceReport {
  const byNit = new Map(suppliers.map((s) => [s.nit, s]));
  const categories = new Map(titles.map((t) => [t.normalizedTitle, t.category]));
  const decisions = options.decisions ?? {};
  const seen = new Map<string, string>();

  const reportRows = results.map((r) => {
    const decision = decisions[r.fileName] ?? {};
    if (r.kind !== "parsed") return failedRow(r.fileName, r.kind, r.message, Boolean(decision.excluded));
    const { invoice } = r;
    let duplicateOf: string | undefined;
    if (invoice.invoiceNumber) {
      const key = invoiceKey(invoice.supplierNit, invoice.invoiceNumber);
      duplicateOf = seen.get(key);
      if (!duplicateOf) seen.set(key, r.fileName);
    }
    return parsedRow(r.fileName, invoice, byNit.get(invoice.supplierNit), categories.get(normalizeKey(invoice.documentType)), duplicateOf, decision);
  });
  const parsed = reportRows.filter((r) => r.supplierNit);
  const active = parsed.filter((r) => r.status !== "excluded");

  // Proveedores sin registrar o registrados sin Tipo IVA: uno por NIT, sin importar cuántas facturas tenga.
  const pendingNames = new Map<string, string[]>();
  for (const r of active) {
    if (r.vatType) continue;
    const list = pendingNames.get(r.supplierNit!) ?? [];
    list.push(r.supplierName ?? "");
    pendingNames.set(r.supplierNit!, list);
  }
  const pendingSuppliers: PendingSupplier[] = [...pendingNames.entries()].map(([nit, names]) => ({ nit, name: mostFrequent(names.filter(Boolean)), invoiceCount: names.length, registered: byNit.get(nit) }));

  // Títulos sin clasificar: uno por título normalizado.
  const unknown = new Map<string, UnknownTitle>();
  for (const r of active) {
    if (r.category || r.documentType === NO_TITLE) continue;
    const t = unknown.get(r.documentTypeKey!);
    if (t) t.documentCount++;
    else unknown.set(r.documentTypeKey!, { normalizedTitle: r.documentTypeKey!, displayTitle: r.documentType!, documentCount: 1 });
  }

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

  const incidents: Incident[] = [];
  for (const r of reportRows) {
    const type = r.status === "incompatible" ? "No compatible" : r.status === "error" ? "Error" : r.supplierNit ? "Requiere revisión" : "No procesado";
    for (const issue of r.issues) incidents.push({ fileName: r.fileName, type, detail: issue });
    if (r.status === "excluded") incidents.push({ fileName: r.fileName, type: "Excluido por el usuario", detail: "El documento no se incluye en el resumen." });
    for (const i of r.pendingLines) {
      const p = r.products[i];
      incidents.push({ fileName: r.fileName, type: "Fila no interpretable", detail: `Página ${p.page}: ${p.description || "(sin descripción)"} — ${p.issue ?? "Sin tarifa de IVA."}` });
    }
    for (const note of r.notes) incidents.push({ fileName: r.fileName, type: "Información", detail: note });
  }

  const count = (test: (r: InvoiceRow) => boolean) => reportRows.filter(test).length;
  return {
    rows: reportRows,
    stats: {
      files: reportRows.length,
      validated: count((r) => r.status === "processed"),
      pending: count(needsAttention),
      excluded: count((r) => r.status === "excluded"),
      invoices: count((r) => r.category === "invoice"),
      notes: count((r) => r.category === "credit_note"),
      suppliers: new Set(parsed.map((r) => r.supplierNit)).size,
      newSuppliers: pendingSuppliers.length,
      duplicates: parsed.filter((r) => r.duplicateOf).length,
    },
    pendingSuppliers,
    unknownTitles: [...unknown.values()],
    nameMismatches: [...mismatches.values()],
    summary: summarize(reportRows),
    incidents,
  };
}
