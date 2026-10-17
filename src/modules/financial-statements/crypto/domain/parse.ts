import type { Cell, Sheet, Workbook } from "../../../../types/excel";
import { cellDate } from "../../../../utils/dates";
import { cellAmount } from "../../../../utils/numbers";
import { fieldLabel, fieldOfHeader, headerKey, kindOfSheet, REQUIRED_FIELDS, SHEET_NAMES, type CryptoField } from "./headers";
import { fingerprintRow } from "./hash";
import type { CellValue, CryptoKind, CryptoRowInput, RowData } from "./types";

/** El archivo no tiene el contrato esperado (hojas o columnas mínimas); el mensaje dice exactamente qué falta. */
export class CryptoFormatError extends Error {}

export interface ParsedCryptoWorkbook {
  fileName: string;
  /** Hojas del contrato que se leyeron («Compras», «Ventas»). */
  sheets: string[];
  rows: CryptoRowInput[];
  purchases: number;
  sales: number;
  /** Filas bajo el encabezado de cada hoja leída, con y sin información. Leídas = guardadas + vacías omitidas. */
  sourceRows: { purchase: number; sale: number };
  /** Filas completamente vacías (o solo con celdas en blanco) que no se guardan: no son operaciones. */
  blankRows: { purchase: number; sale: number };
  /** Observaciones que no impiden importar (una hoja ausente, hojas auxiliares ignoradas…). */
  warnings: string[];
  /** Hojas del archivo que no pertenecen al contrato y se ignoraron. */
  ignoredSheets: string[];
}

const MAX_HEADER_SEARCH = 10;
const MONEY_FIELDS: CryptoField[] = ["amount"];

const textOf = (cell: Cell | undefined): CellValue | null => {
  if (!cell) return null;
  if (cell.t === "s") return cell.v.trim() === "" ? null : cell.v.trim();
  if (cell.t === "n") return Number.isFinite(cell.v) ? cell.v : null;
  if (cell.t === "d") return cell.v;
  if (cell.t === "b") return cell.v ? "VERDADERO" : "FALSO";
  return null;
};

const iso = (cell: Cell): string | null => {
  const d = cellDate(cell);
  return d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null;
};

/** Valor guardado de una celda: fechas en AAAA-MM-DD, importes como número y el resto como texto (un documento 800197268 nunca queda como 8.0e8). */
function storedValue(field: CryptoField | undefined, cell: Cell | undefined): CellValue | null {
  const raw = textOf(cell);
  if (raw === null || !cell) return null;
  if (field === "date") return iso(cell) ?? raw;
  if (field && MONEY_FIELDS.includes(field)) {
    const n = cellAmount(cell);
    return n === null ? raw : n;
  }
  if (field === "rate" || field === "quantity") return raw;
  return typeof raw === "number" ? String(raw) : raw;
}

interface HeaderMatch {
  row: number;
  /** Índice de columna → campo reconocido (o undefined: columna de auditoría). */
  columns: { index: number; header: string; field: CryptoField | undefined }[];
  fields: Set<CryptoField>;
}

function findHeader(sheet: Sheet, kind: CryptoKind): HeaderMatch | undefined {
  let best: HeaderMatch | undefined;
  for (let r = 0; r < Math.min(MAX_HEADER_SEARCH, sheet.rows.length); r++) {
    const columns: HeaderMatch["columns"] = [];
    const fields = new Set<CryptoField>();
    sheet.rows[r].forEach((cell, index) => {
      const header = cell.t === "s" ? cell.v.trim() : cell.t === "n" ? String(cell.v) : "";
      if (!header) return;
      const field = fieldOfHeader(kind, header);
      // Un campo repetido conserva la primera columna; la repetida queda como dato de auditoría.
      const duplicate = field !== undefined && fields.has(field);
      if (field !== undefined && !duplicate) fields.add(field);
      columns.push({ index, header, field: duplicate ? undefined : field });
    });
    if (!best || fields.size > best.fields.size) best = { row: r, columns, fields };
  }
  return best && best.fields.size > 0 ? best : undefined;
}

function parseSheet(sheet: Sheet, kind: CryptoKind): { rows: CryptoRowInput[]; sourceRows: number; blankRows: number } {
  const header = findHeader(sheet, kind);
  const missing = (have: Set<CryptoField>) => REQUIRED_FIELDS[kind].filter((f) => !have.has(f)).map((f) => `«${fieldLabel(kind, f)}»`);
  if (!header || missing(header.fields).length) {
    const lack = header ? missing(header.fields) : REQUIRED_FIELDS[kind].map((f) => `«${fieldLabel(kind, f)}»`);
    throw new CryptoFormatError(`La hoja «${SHEET_NAMES[kind]}» no tiene ${lack.length === 1 ? "la columna" : "las columnas"} ${lack.join(" y ")}.`);
  }
  const rows: CryptoRowInput[] = [];
  let blankRows = 0;
  const sourceRows = Math.max(0, sheet.rows.length - header.row - 1);
  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r];
    if (!cells) {
      blankRows++;
      continue;
    }
    const data: RowData = {};
    for (const col of header.columns) {
      const value = storedValue(col.field, cells[col.index]);
      if (value === null) continue;
      // Dos columnas con el mismo texto de encabezado: la segunda no pisa a la primera.
      let key = col.header;
      for (let n = 2; key in data; n++) key = `${col.header} (${n})`;
      data[key] = value;
    }
    if (Object.keys(data).length === 0) {
      blankRows++;
      continue;
    }
    rows.push({ kind, sheet: sheet.name, rowNumber: r + 1, fingerprint: fingerprintRow(kind, data), data });
  }
  return { rows, sourceRows, blankRows };
}

/**
 * Lee el libro de Transacciones Cripto: solo las hojas «Compras» y «Ventas» (cualquier otra, como Hoja3, C o V, se ignora).
 * Las columnas opcionales vacías no impiden importar: cada fila se conserva tal como llegó y los datos que falten se explican
 * después, formato por formato.
 */
export function parseCryptoWorkbook(book: Workbook): ParsedCryptoWorkbook {
  const rows: CryptoRowInput[] = [];
  const sheets: string[] = [];
  const ignoredSheets: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<CryptoKind>();
  const sourceRows = { purchase: 0, sale: 0 };
  const blankRows = { purchase: 0, sale: 0 };
  for (const sheet of book.sheets) {
    const kind = kindOfSheet(sheet.name);
    if (!kind || seen.has(kind)) {
      ignoredSheets.push(sheet.name);
      continue;
    }
    seen.add(kind);
    sheets.push(sheet.name);
    const parsed = parseSheet(sheet, kind);
    rows.push(...parsed.rows);
    sourceRows[kind] = parsed.sourceRows;
    blankRows[kind] = parsed.blankRows;
  }
  if (seen.size === 0) throw new CryptoFormatError("El archivo no tiene las hojas «Compras» ni «Ventas».");
  for (const kind of ["purchase", "sale"] as const) if (!seen.has(kind)) warnings.push(`El archivo no tiene la hoja «${SHEET_NAMES[kind]}»: no aporta ${kind === "purchase" ? "compras ni cobertura mensual" : "ventas"}.`);
  if (rows.length === 0) throw new CryptoFormatError("Las hojas «Compras» y «Ventas» no tienen filas con información.");
  return {
    fileName: book.fileName,
    sheets,
    rows,
    purchases: rows.filter((r) => r.kind === "purchase").length,
    sales: rows.filter((r) => r.kind === "sale").length,
    sourceRows,
    blankRows,
    warnings,
    ignoredSheets,
  };
}

export { headerKey };
