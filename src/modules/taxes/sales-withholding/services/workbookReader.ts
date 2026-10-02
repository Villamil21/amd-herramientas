import type { Cell, Sheet, Workbook } from "../../../../types/excel";
import { cellDate, formatDateShort } from "../../../../utils/dates";
import { normalizeKey } from "../../../../utils/text";
import { SalesWithholdingError, TAX_COLUMNS, type ParsedSalesFile, type ReadResult, type SalesRow, type TaxColumn } from "../types";
import { cellMicro, sumMicro } from "./decimal";

/** Columnas sin las cuales no se calcula (se buscan por nombre, nunca por letra). */
export const REQUIRED_COLUMNS = ["Tipo de documento", "NIT Emisor", "Nombre Emisor", "Total", ...TAX_COLUMNS] as const;
/** Columnas informativas (auditoría y duplicados). */
const OPTIONAL = { cufe: "CUFE/CUDE", folio: "Folio", prefix: "Prefijo", issueDate: "Fecha Emisión" } as const;

/** El encabezado se busca en las primeras filas de la hoja. */
const HEADER_SCAN_ROWS = 20;

/** «Ventas», « VENTAS », «VeNtAs» → «ventas». */
export const normalizeSheetName = (name: string) => name.trim().toLowerCase();
const SALES_SHEET = "ventas";

/** NIT comparable: sin puntos ni espacios y sin el dígito de verificación tras el guion. */
export const normalizeNit = (text: string) => text.split("-")[0].replace(/\D/g, "");

function cellText(cell: Cell | undefined): string {
  if (!cell) return "";
  switch (cell.t) {
    case "s":
    case "d":
    case "x":
      return cell.v.trim();
    case "n":
      return String(cell.v);
    case "b":
      return cell.v ? "VERDADERO" : "FALSO";
    default:
      return "";
  }
}

interface Header {
  rowIndex: number;
  /** normalizeKey del encabezado → índice de columna (primera aparición). */
  columns: Map<string, number>;
}

const REQUIRED_KEYS = REQUIRED_COLUMNS.map(normalizeKey);

/** Fila de encabezado: la que más columnas requeridas tiene entre las primeras filas. */
function findHeader(sheet: Sheet): { header: Header; missing: string[] } {
  let best: Header = { rowIndex: 0, columns: new Map() };
  let bestScore = -1;
  sheet.rows.slice(0, HEADER_SCAN_ROWS).forEach((row, rowIndex) => {
    const columns = new Map<string, number>();
    row.forEach((cell, i) => {
      const key = normalizeKey(cellText(cell));
      if (key && !columns.has(key)) columns.set(key, i);
    });
    const score = REQUIRED_KEYS.filter((k) => columns.has(k)).length;
    if (score > bestScore) {
      best = { rowIndex, columns };
      bestScore = score;
    }
  });
  const missing = REQUIRED_COLUMNS.filter((name) => !best.columns.has(normalizeKey(name)));
  return { header: best, missing };
}

function missingColumnsError(missing: string[]): SalesWithholdingError {
  const list = missing.map((m) => `"${m}"`);
  return new SalesWithholdingError(
    list.length === 1 ? `No se puede calcular la base porque falta la columna ${list[0]}.` : `No se puede calcular la base porque faltan las columnas ${list.join(", ")}.`,
  );
}

const isEmpty = (cell: Cell | undefined) => !cell || cell.t === "e";

function issueDate(cell: Cell | undefined): string {
  if (cell?.t === "d" || cell?.t === "n") {
    const d = cellDate(cell);
    if (d) return formatDateShort(d);
  }
  return cellText(cell);
}

function extract(workbook: Workbook, sheet: Sheet, header: Header): ParsedSalesFile {
  const col = (name: string) => header.columns.get(normalizeKey(name));
  const required = REQUIRED_COLUMNS.map((name) => col(name)!);
  const at = (row: Cell[], name: string) => {
    const c = col(name);
    return c === undefined ? undefined : row[c];
  };

  const rows: SalesRow[] = [];
  for (let r = header.rowIndex + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    // Filas totalmente vacías en las columnas requeridas (separadores, final del archivo).
    if (required.every((c) => isEmpty(row[c]))) continue;

    const invalid: { column: string; text: string }[] = [];
    const amount = (name: string) => {
      const cell = at(row, name);
      const value = cellMicro(cell);
      if (value === null) invalid.push({ column: name, text: cellText(cell) });
      return value;
    };
    const total = amount("Total");
    const taxes = Object.fromEntries(TAX_COLUMNS.map((name) => [name, amount(name)])) as Record<TaxColumn, bigint | null>;
    const taxValues = Object.values(taxes);
    const taxesSum = taxValues.every((v) => v !== null) ? sumMicro(taxValues as bigint[]) : null;
    const documentType = cellText(at(row, "Tipo de documento")).replace(/\s+/g, " ");
    const nitText = cellText(at(row, "NIT Emisor"));

    rows.push({
      rowNumber: r + 1,
      documentType,
      typeKey: normalizeKey(documentType),
      cufe: cellText(at(row, OPTIONAL.cufe)),
      folio: cellText(at(row, OPTIONAL.folio)),
      prefix: cellText(at(row, OPTIONAL.prefix)),
      issueDate: issueDate(at(row, OPTIONAL.issueDate)),
      nitText,
      nit: normalizeNit(nitText),
      issuerName: cellText(at(row, "Nombre Emisor")),
      total,
      taxes,
      invalid,
      taxesSum,
      base: total !== null && taxesSum !== null ? total - taxesSum : null,
    });
  }

  if (rows.length === 0) throw new SalesWithholdingError(`La hoja «${sheet.name}» tiene los encabezados esperados, pero no contiene ventas.`);
  return { fileName: workbook.fileName, sheetName: sheet.name, ignoredSheets: workbook.sheets.filter((s) => s !== sheet).map((s) => s.name), rows };
}

/** Filas con datos de una hoja (para elegir entre hojas con el mismo nombre normalizado). */
function dataRows(sheet: Sheet): number {
  const { header } = findHeader(sheet);
  return sheet.rows.slice(header.rowIndex + 1).filter((row) => row.some((c) => !isEmpty(c))).length;
}

/**
 * Lee exclusivamente la hoja «Ventas» (sin distinguir mayúsculas ni espacios
 * al inicio/final) y localiza las columnas por nombre de encabezado. Si varias
 * hojas se llaman igual, pide elegir en vez de tomar una arbitrariamente.
 *
 * `sheetName` fuerza una hoja (cuando el usuario la eligió).
 */
export function readSalesWorkbook(workbook: Workbook, sheetName?: string): ReadResult {
  const candidates = workbook.sheets.filter((s) => normalizeSheetName(s.name) === SALES_SHEET);
  if (candidates.length === 0) throw new SalesWithholdingError("No se encontró una hoja llamada Ventas en el archivo seleccionado.");

  let sheet: Sheet;
  if (sheetName !== undefined) {
    const chosen = candidates.find((s) => s.name === sheetName);
    if (!chosen) throw new SalesWithholdingError(`La hoja «${sheetName}» no es una hoja Ventas del archivo.`);
    sheet = chosen;
  } else if (candidates.length > 1) {
    return { kind: "choose-sheet", candidates: candidates.map((s) => ({ name: s.name, rows: dataRows(s) })) };
  } else {
    sheet = candidates[0];
  }

  const { header, missing } = findHeader(sheet);
  if (missing.length > 0) throw missingColumnsError(missing);
  return { kind: "ok", file: extract(workbook, sheet, header) };
}
