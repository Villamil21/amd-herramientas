import { formatInteger } from "../../../../utils/format";
import { normalizeKey } from "../../../../utils/text";
import { NO_TITLE } from "../parser/pucParser";
import type {
  Allocation,
  Assignments,
  Classification,
  CodeSummaryRow,
  DocAssignment,
  DocCategory,
  DocLine,
  DocRow,
  DocumentSummaryRow,
  ExtractionIssue,
  FileResult,
  ParsedPucDocument,
  PucReport,
  RowProblem,
  TitleRule,
  UnknownTitle,
} from "../types";
import { leafConcept, type PucIndex } from "./pucCatalog";

const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", formatInteger(n)));

/** Factura electrónica suma; Nota crédito resta. */
export const signOf = (category: DocCategory) => (category === "credit_note" ? -1 : 1);

const numberKey = (nit: string, number: string) => `${nit}|${number.replace(/[\s-]/g, "").toUpperCase()}`;

interface Duplicate {
  of: string;
  by: "cufe" | "number";
}

/**
 * Detecta documentos repetidos en el lote. Prioridad: CUFE / CUDE. Respaldo:
 * NIT emisor + número, solo cuando alguno de los dos no trae CUFE (dos CUFE
 * distintos son documentos distintos). Los excluidos no cuentan.
 */
function findDuplicates(results: FileResult[], assignments: Assignments): Map<string, Duplicate> {
  const byCufe = new Map<string, string>();
  const byNumber = new Map<string, { fileName: string; cufe?: string }>();
  const out = new Map<string, Duplicate>();
  for (const r of results) {
    if (r.kind !== "parsed" || assignments[r.fileName]?.excluded) continue;
    const { doc } = r;
    const key = doc.number ? numberKey(doc.issuerNit, doc.number) : undefined;
    const sameCufe = doc.cufe ? byCufe.get(doc.cufe) : undefined;
    const sameNumber = key ? byNumber.get(key) : undefined;
    if (sameCufe) out.set(r.fileName, { of: sameCufe, by: "cufe" });
    else if (sameNumber && !(sameNumber.cufe && doc.cufe)) out.set(r.fileName, { of: sameNumber.fileName, by: "number" });
    else {
      if (doc.cufe) byCufe.set(doc.cufe, r.fileName);
      if (key && !sameNumber) byNumber.set(key, { fileName: r.fileName, cufe: doc.cufe });
    }
  }
  return out;
}

function failedRow(fileName: string, kind: "incompatible" | "error", message: string, excluded: boolean): DocRow {
  return { fileName, failure: { kind, message }, excluded, classification: "pending", lines: [], classifiedLines: 0, problems: [], allocations: [], assignedCents: 0 };
}

function parsedRow(fileName: string, doc: ParsedPucDocument, index: PucIndex, category: DocCategory | undefined, duplicate: Duplicate | undefined, assignment: DocAssignment): DocRow {
  const { mode } = assignment;
  const excluded = Boolean(assignment.excluded);
  const documentCode = mode === "document" ? assignment.documentCode : undefined;
  const documentConcept = leafConcept(index, documentCode);

  const lines: DocLine[] = doc.products.map((p, i) => {
    // Con un solo código, todas las líneas reciben el de la factura.
    const code = mode === "document" ? documentCode : mode === "product" ? assignment.lineCodes?.[i] : undefined;
    return { ...p, index: i, code, concept: leafConcept(index, code) };
  });
  const classifiedLines = lines.filter((l) => l.concept).length;

  const problems: RowProblem[] = [];
  const problem = (code: RowProblem["code"], text: string) => problems.push({ code, text });
  const blocked = doc.title === NO_TITLE || (duplicate !== undefined && !assignment.includeDuplicate);

  if (doc.title === NO_TITLE) problem("title-missing", "No se encontró el título del documento: no se puede saber si suma (Factura electrónica) o resta (Nota crédito).");
  if (duplicate && !assignment.includeDuplicate) {
    problem(
      "duplicate",
      duplicate.by === "cufe"
        ? `Duplicado de «${duplicate.of}» (mismo CUFE / CUDE): no se suma dos veces.`
        : `Posible duplicado de «${duplicate.of}» (mismo NIT emisor y número de factura): no se suma hasta resolverlo.`,
    );
  }

  let classification: Classification = "pending";
  if (!mode) {
    problem("no-mode", "Falta elegir cómo asignar el código PUC: un solo código para toda la factura o un código por producto.");
  } else if (mode === "document") {
    if (!documentCode) problem("no-code", "Falta el código PUC de la factura.");
    else if (!documentConcept) problem("invalid-code", `El código ${documentCode} no existe en la Tabla de Códigos PUC.`);
    else classification = "classified";
    if (doc.grossTotalCents === undefined) problem("gross-missing", "No se identificó «Total Bruto Factura» en Datos Totales: no hay valor para asignar al código único.");
  } else {
    const unread = lines.filter((l) => l.issue).length;
    const invalid = lines.filter((l) => l.code && !l.concept).length;
    const missing = lines.filter((l) => !l.issue && !l.code).length;
    if (lines.length === 0) problem("no-products", "No se encontraron productos en «Detalles de Productos».");
    if (unread) problem("lines-unread", count(unread, "1 producto sin Descripción o «Precio unitario de venta» interpretados.", "# productos sin Descripción o «Precio unitario de venta» interpretados."));
    if (invalid) problem("invalid-code", count(invalid, "1 producto tiene un código que no existe en la Tabla de Códigos PUC.", "# productos tienen un código que no existe en la Tabla de Códigos PUC."));
    if (missing) problem("lines-without-code", count(missing, "1 producto sin código PUC.", "# productos sin código PUC."));
    if (lines.length > 0 && classifiedLines === lines.length) classification = "classified";
    else if (classifiedLines > 0) classification = "partial";
  }

  // Valores con signo. Sin categoría no hay signo; un duplicado sin resolver no suma.
  const allocations: Allocation[] = [];
  if (!excluded && category && !blocked) {
    const sign = signOf(category);
    if (mode === "document" && documentCode && documentConcept && doc.grossTotalCents !== undefined) {
      // Regla del modo «un solo código»: Total Bruto Factura, nunca la suma del detalle.
      allocations.push({ code: documentCode, concept: documentConcept, valueCents: sign * doc.grossTotalCents });
    } else if (mode === "product") {
      for (const l of lines) {
        if (!l.code || !l.concept || l.priceCents === undefined) continue;
        const found = allocations.find((a) => a.code === l.code);
        if (found) found.valueCents += sign * l.priceCents;
        else allocations.push({ code: l.code, concept: l.concept, valueCents: sign * l.priceCents });
      }
      allocations.sort((a, b) => (a.code < b.code ? -1 : 1));
    }
  }

  return {
    fileName,
    excluded,
    classification,
    title: doc.title,
    titleKey: normalizeKey(doc.title),
    category,
    number: doc.number,
    cufe: doc.cufe,
    issueDate: doc.issueDate,
    issuerNit: doc.issuerNit,
    issuerName: doc.issuerName,
    pageCount: doc.pageCount,
    grossTotalCents: doc.grossTotalCents,
    mode,
    documentCode,
    documentConcept,
    lines,
    classifiedLines,
    duplicateOf: duplicate?.of,
    duplicateBy: duplicate?.by,
    problems: excluded ? [] : problems,
    allocations,
    assignedCents: allocations.reduce((s, a) => s + a.valueCents, 0),
  };
}

/** Documento que todavía exige algo del usuario (bloquea la exportación). */
export const needsAttention = (r: DocRow) => !r.excluded && (Boolean(r.failure) || !r.category || r.problems.length > 0);

/**
 * Cruza los documentos leídos con la tabla PUC, la clasificación de títulos y
 * las asignaciones del usuario, y arma tabla, pendientes y resúmenes. Es una
 * función pura: al asignar o cambiar un código basta con volver a llamarla
 * (no se releen los PDF).
 */
export function buildReport(results: FileResult[], index: PucIndex, titles: TitleRule[], assignments: Assignments = {}): PucReport {
  const categories = new Map(titles.map((t) => [t.normalizedTitle, t.category]));
  const duplicates = findDuplicates(results, assignments);

  const rows = results.map((r) => {
    const assignment = assignments[r.fileName] ?? {};
    if (r.kind !== "parsed") return failedRow(r.fileName, r.kind, r.message, Boolean(assignment.excluded));
    return parsedRow(r.fileName, r.doc, index, categories.get(normalizeKey(r.doc.title)), duplicates.get(r.fileName), assignment);
  });
  const active = rows.filter((r) => !r.excluded);

  // Títulos sin clasificar: uno por título normalizado.
  const unknown = new Map<string, UnknownTitle>();
  for (const r of active) {
    if (r.failure || r.category || r.title === NO_TITLE) continue;
    const t = unknown.get(r.titleKey!);
    if (t) t.documentCount++;
    else unknown.set(r.titleKey!, { normalizedTitle: r.titleKey!, displayTitle: r.title!, documentCount: 1 });
  }

  const byCode = new Map<string, CodeSummaryRow>();
  const byDocument: DocumentSummaryRow[] = [];
  for (const r of active) {
    for (const a of r.allocations) {
      const row = byCode.get(a.code) ?? { code: a.code, concept: a.concept, invoicesCents: 0, notesCents: 0, netCents: 0 };
      if (r.category === "credit_note") row.notesCents += a.valueCents;
      else row.invoicesCents += a.valueCents;
      row.netCents += a.valueCents;
      byCode.set(a.code, row);
      byDocument.push({ ...a, fileName: r.fileName, number: r.number, issuerName: r.issuerName, category: r.category! });
    }
  }
  const summary = [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
  const totals = summary.reduce((t, s) => ({ invoicesCents: t.invoicesCents + s.invoicesCents, notesCents: t.notesCents + s.notesCents, netCents: t.netCents + s.netCents }), { invoicesCents: 0, notesCents: 0, netCents: 0 });

  const extractionIssues: ExtractionIssue[] = [];
  for (const r of rows) {
    for (const l of r.lines) if (l.issue) extractionIssues.push({ fileName: r.fileName, page: l.page, row: l.row, detectedText: l.detectedText ?? "", reason: l.issue });
  }

  const tally = (test: (r: DocRow) => boolean) => rows.filter(test).length;
  return {
    rows,
    unknownTitles: [...unknown.values()],
    summary,
    totals,
    byDocument,
    extractionIssues,
    stats: {
      files: rows.length,
      pending: tally((r) => !r.excluded && r.classification === "pending"),
      partial: tally((r) => !r.excluded && r.classification === "partial"),
      classified: tally((r) => !r.excluded && r.classification === "classified"),
      invoices: tally((r) => r.category === "invoice"),
      notes: tally((r) => r.category === "credit_note"),
      excluded: tally((r) => r.excluded),
      duplicates: tally((r) => Boolean(r.duplicateOf)),
    },
  };
}

// ---------------------------------------------------------------------------
// Cambios de asignación (devuelven la nueva asignación; no mutan la anterior)
// ---------------------------------------------------------------------------

/** Códigos por producto que ya tiene el documento (lo que se perdería al aplicar un solo código). */
export const assignedLineCount = (a: DocAssignment | undefined) => Object.keys(a?.lineCodes ?? {}).length;

/** Elige la modalidad. Al pasar a «por producto», las líneas conservan el código que tenía la factura. */
export function withMode(a: DocAssignment, mode: DocAssignment["mode"], lineCount: number): DocAssignment {
  if (a.mode === mode) return a;
  if (mode === "document") return { ...a, mode, documentCode: undefined, lineCodes: undefined };
  const lineCodes: Record<number, string> = {};
  if (a.mode === "document" && a.documentCode) for (let i = 0; i < lineCount; i++) lineCodes[i] = a.documentCode;
  return { ...a, mode, documentCode: undefined, lineCodes };
}

/** Un solo código para toda la factura (reemplaza los códigos por producto). */
export const withDocumentCode = (a: DocAssignment, code: string | undefined): DocAssignment => ({ ...a, mode: "document", documentCode: code, lineCodes: undefined });

/** Asigna (o quita, con `undefined`) el código de varias líneas. */
export function withLineCodes(a: DocAssignment, indexes: number[], code: string | undefined): DocAssignment {
  const lineCodes = { ...a.lineCodes };
  for (const i of indexes) {
    if (code === undefined) delete lineCodes[i];
    else lineCodes[i] = code;
  }
  return { ...a, mode: "product", documentCode: undefined, lineCodes };
}
