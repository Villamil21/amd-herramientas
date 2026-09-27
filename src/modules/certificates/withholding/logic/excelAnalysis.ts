import type { Cell, Sheet, Workbook } from "../../../../types/excel";
import { cellAmount, toCents } from "../../../../utils/numbers";
import { normalizeKey } from "../../../../utils/text";
import { cellDate, compareDates, taxablePeriod, type Period, type SimpleDate } from "../../../../utils/dates";
import { formatMoneyCents } from "../../../../utils/format";
import { DOCUMENT_TYPES, MAIN_COLUMNS, PRIOR_RETENTION_COLUMNS, REQUIRED_COLUMNS, TAX_COLUMNS } from "./columns";

export interface AnalysisIssue {
  message: string;
  /** Detalle opcional (NIT encontrados, filas, etc.). */
  details?: string[];
}

export interface PriorRetention {
  row: number;
  column: string;
  cents: number;
}

export interface NormalizedDocument {
  row: number; // número de fila en Excel (1 = primera fila)
  tipo: string;
  sign: 1 | -1;
  fecha: SimpleDate;
  nitEmisor: string;
  nombreEmisor: string;
  totalCents: number;
  taxesCents: number;
  /** Total − impuestos, sin signo. */
  baseCents: number;
  /** Base con el signo del tipo de documento. */
  adjustedBaseCents: number;
}

export interface ExcelAnalysis {
  fileName: string;
  sheetName: string;
  headerRow: number;
  documents: NormalizedDocument[];
  invoiceCount: number;
  creditNoteCount: number;
  retenido: { nombre: string; nit: string } | null;
  nits: { nit: string; rows: number[] }[];
  dateMin: SimpleDate | null;
  dateMax: SimpleDate | null;
  period: Period | null;
  baseCents: number;
  /** Bloquean la generación del certificado. */
  errors: AnalysisIssue[];
  /** Informativas, no bloquean. */
  warnings: AnalysisIssue[];
  /** Requieren confirmación consciente del usuario. */
  priorRetentions: PriorRetention[];
}

const HEADER_SCAN_ROWS = 20;
const MAX_ROWS_LISTED = 8;

function cellText(cell: Cell | undefined): string {
  if (!cell) return "";
  switch (cell.t) {
    case "s":
    case "d":
      return cell.v.trim();
    case "n":
      return Number.isInteger(cell.v) ? String(cell.v) : String(cell.v);
    case "b":
      return cell.v ? "VERDADERO" : "FALSO";
    default:
      return "";
  }
}

/** NIT comparable: sin espacios ni puntos. */
export function normalizeNit(raw: string): string {
  return raw.replace(/[\s.]/g, "").trim();
}

function rowsLabel(rows: number[]): string {
  const shown = rows.slice(0, MAX_ROWS_LISTED).join(", ");
  return rows.length > MAX_ROWS_LISTED ? `${shown} y ${rows.length - MAX_ROWS_LISTED} más` : shown;
}

function findHeader(sheet: Sheet): { row: number; map: Map<string, number> } | null {
  const tipoKey = normalizeKey(MAIN_COLUMNS.tipoDocumento);
  const totalKey = normalizeKey(MAIN_COLUMNS.total);
  for (let r = 0; r < Math.min(sheet.rows.length, HEADER_SCAN_ROWS); r++) {
    const map = new Map<string, number>();
    sheet.rows[r].forEach((cell, c) => {
      const key = normalizeKey(cellText(cell));
      if (key && !map.has(key)) map.set(key, c);
    });
    if (map.has(tipoKey) && map.has(totalKey)) return { row: r, map };
  }
  return null;
}

function emptyAnalysis(fileName: string, sheetName: string): ExcelAnalysis {
  return {
    fileName, sheetName, headerRow: 0, documents: [], invoiceCount: 0, creditNoteCount: 0,
    retenido: null, nits: [], dateMin: null, dateMax: null, period: null, baseCents: 0,
    errors: [], warnings: [], priorRetentions: [],
  };
}

export function analyzeWorkbook(book: Workbook): ExcelAnalysis {
  // Primera hoja que tenga la fila de encabezados esperada.
  let sheet: Sheet | undefined;
  let header: ReturnType<typeof findHeader> = null;
  for (const s of book.sheets) {
    header = findHeader(s);
    if (header) {
      sheet = s;
      break;
    }
  }
  if (!sheet || !header) {
    const result = emptyAnalysis(book.fileName, book.sheets[0]?.name ?? "");
    result.errors.push({
      message: "No se encontró la fila de encabezados del reporte.",
      details: [`El archivo debe contener, como mínimo, las columnas «${MAIN_COLUMNS.tipoDocumento}» y «${MAIN_COLUMNS.total}».`],
    });
    return result;
  }

  const result = emptyAnalysis(book.fileName, sheet.name);
  result.headerRow = header.row + 1;

  const missing = REQUIRED_COLUMNS.filter((name) => !header!.map.has(normalizeKey(name)));
  if (missing.length > 0) {
    result.errors.push({
      message: "Faltan columnas necesarias en el archivo.",
      details: missing.map((m) => `Columna «${m}»`),
    });
    return result;
  }
  const col = (name: string) => header!.map.get(normalizeKey(name))!;

  const typeBySign = new Map(DOCUMENT_TYPES.map((t) => [normalizeKey(t.name), t]));
  const unknownTypes = new Map<string, number[]>();
  const nitRows = new Map<string, number[]>();
  const names = new Map<string, string>(); // nombre normalizado → nombre original
  const invalid: string[] = [];

  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    const excelRow = r + 1;
    if (!row || row.every((c) => c.t === "e")) continue;

    const tipoRaw = cellText(row[col(MAIN_COLUMNS.tipoDocumento)]);
    const tipo = typeBySign.get(normalizeKey(tipoRaw));
    if (!tipo) {
      const label = tipoRaw || "(vacío)";
      unknownTypes.set(label, [...(unknownTypes.get(label) ?? []), excelRow]);
      continue;
    }

    const rowErrors: string[] = [];
    const fecha = cellDate(row[col(MAIN_COLUMNS.fechaEmision)]);
    if (!fecha) rowErrors.push(`La fila ${excelRow} no tiene una fecha válida en la columna ${MAIN_COLUMNS.fechaEmision}.`);

    const nit = normalizeNit(cellText(row[col(MAIN_COLUMNS.nitEmisor)]));
    if (!nit) rowErrors.push(`La fila ${excelRow} no tiene valor en la columna ${MAIN_COLUMNS.nitEmisor}.`);

    const nombre = cellText(row[col(MAIN_COLUMNS.nombreEmisor)]);
    if (!nombre) rowErrors.push(`La fila ${excelRow} no tiene valor en la columna ${MAIN_COLUMNS.nombreEmisor}.`);

    const totalCell = row[col(MAIN_COLUMNS.total)];
    const total = cellAmount(totalCell);
    if (total === null || !totalCell || totalCell.t === "e") {
      rowErrors.push(`La fila ${excelRow} contiene un valor no válido en la columna ${MAIN_COLUMNS.total}.`);
    }

    let taxesCents = 0;
    for (const tax of TAX_COLUMNS) {
      const v = cellAmount(row[col(tax)]);
      if (v === null) rowErrors.push(`La fila ${excelRow} contiene un valor no válido en la columna ${tax}.`);
      else taxesCents += toCents(v);
    }

    for (const ret of PRIOR_RETENTION_COLUMNS) {
      const v = cellAmount(row[col(ret)]);
      if (v === null) rowErrors.push(`La fila ${excelRow} contiene un valor no válido en la columna ${ret}.`);
      else if (toCents(v) !== 0) result.priorRetentions.push({ row: excelRow, column: ret, cents: toCents(v) });
    }

    if (rowErrors.length > 0 || !fecha || total === null) {
      invalid.push(...rowErrors);
      continue;
    }

    const totalCents = toCents(total);
    const baseCents = totalCents - taxesCents;
    result.documents.push({
      row: excelRow,
      tipo: tipo.name,
      sign: tipo.sign,
      fecha,
      nitEmisor: nit,
      nombreEmisor: nombre,
      totalCents,
      taxesCents,
      baseCents,
      adjustedBaseCents: baseCents * tipo.sign,
    });
    nitRows.set(nit, [...(nitRows.get(nit) ?? []), excelRow]);
    if (!names.has(normalizeKey(nombre))) names.set(normalizeKey(nombre), nombre);
  }

  // --- Errores bloqueantes ---
  for (const [tipo, rows] of unknownTypes) {
    result.errors.push({
      message: `Tipo de documento no reconocido: «${tipo}».`,
      details: [
        `Filas: ${rowsLabel(rows)}.`,
        `Solo se aceptan: ${DOCUMENT_TYPES.map((t) => t.name).join(" y ")}. Revisa el archivo.`,
      ],
    });
  }
  if (invalid.length > 0) {
    result.errors.push({
      message: "Hay filas con información no válida.",
      details: invalid.slice(0, 15).concat(invalid.length > 15 ? [`… y ${invalid.length - 15} problemas más.`] : []),
    });
  }

  result.nits = [...nitRows].map(([nit, rows]) => ({ nit, rows }));
  if (result.nits.length > 1) {
    result.errors.push({
      message: "Se encontraron varios NIT de emisores dentro del archivo.",
      details: result.nits.map((n) => `NIT ${n.nit}: filas ${rowsLabel(n.rows)}`),
    });
  }

  if (result.documents.length === 0 && unknownTypes.size === 0 && invalid.length === 0) {
    result.errors.push({ message: "El archivo no contiene documentos para procesar." });
  }

  // --- Resumen ---
  const docs = result.documents;
  result.invoiceCount = docs.filter((d) => d.sign === 1).length;
  result.creditNoteCount = docs.filter((d) => d.sign === -1).length;
  if (docs.length > 0) {
    result.retenido = { nombre: docs[0].nombreEmisor, nit: docs[0].nitEmisor };
    const sorted = [...docs].sort((a, b) => compareDates(a.fecha, b.fecha));
    result.dateMin = sorted[0].fecha;
    result.dateMax = sorted[sorted.length - 1].fecha;
    result.period = taxablePeriod(result.dateMin, result.dateMax);
    result.baseCents = docs.reduce((sum, d) => sum + d.adjustedBaseCents, 0);

    if (names.size > 1 && result.nits.length === 1) {
      result.warnings.push({
        message: "El nombre del emisor aparece escrito de varias formas.",
        details: [...names.values()].map((n) => `«${n}»`).concat([`Se usará «${result.retenido.nombre}».`]),
      });
    }
    if (result.errors.length === 0 && result.baseCents <= 0) {
      result.errors.push({
        message: `La base de retención calculada es ${formatMoneyCents(result.baseCents)}.`,
        details: ["No se puede generar un certificado con base cero o negativa. Revisa las notas crédito del archivo."],
      });
    }
  }

  return result;
}
