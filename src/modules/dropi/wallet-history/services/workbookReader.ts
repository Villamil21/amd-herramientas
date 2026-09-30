import type { Cell, Sheet, Workbook } from "../../../../types/excel";
import { fromExcelSerial, MONTHS_ES, type SimpleDate } from "../../../../utils/dates";
import { formatInteger } from "../../../../utils/format";
import { moneyCents } from "../../orders/services/workbookReader";
import { statusKey } from "../../orders/services/statuses";
import { WalletHistoryError, type ParsedWalletFile, type ReadResult, type WalletMovement } from "../types";

/** Columnas sin las cuales no se resume el historial. */
export const REQUIRED = {
  date: "FECHA",
  amount: "MONTO",
  description: "DESCRIPCIÓN",
  concept: "CONCEPTO DE RETIRO",
} as const;

/** ID (trazabilidad y duplicados) y TIPO (validación secundaria). MONTO PREVIO no se lee. */
const OPTIONAL = { id: "ID", type: "TIPO" } as const;

/** Encabezados del historial de cartera de Dropi: solo para elegir la hoja más completa. */
const SIGNATURE = ["ID", "FECHA", "TIPO", "MONTO", "MONTO PREVIO", "ORDEN ID", "NUMERO DE GUIA", "DESCRIPCIÓN", "CUENTA", "CONCEPTO DE RETIRO"];

/** El encabezado se busca en las primeras filas de cada hoja. */
const HEADER_SCAN_ROWS = 20;

/** Encabezado comparable: mayúsculas, sin tildes, "_" y espacios repetidos como un espacio. */
const headerKey = statusKey;
const SIGNATURE_KEYS = SIGNATURE.map(headerKey);
const REQUIRED_KEYS = Object.values(REQUIRED).map(headerKey);

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

const isEmpty = (cell: Cell | undefined) => !cell || cell.t === "e" || (cell.t === "s" && !cell.v.trim());

interface HeaderMatch {
  rowIndex: number;
  /** Clave normalizada → índice de columna (primera aparición). */
  columns: Map<string, number>;
  /** Columnas del historial presentes. */
  score: number;
  /** Columnas requeridas presentes. */
  required: number;
}

function findHeader(sheet: Sheet): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  sheet.rows.slice(0, HEADER_SCAN_ROWS).forEach((row, rowIndex) => {
    const columns = new Map<string, number>();
    row.forEach((cell, i) => {
      const key = headerKey(cellText(cell));
      if (key && !columns.has(key)) columns.set(key, i);
    });
    const required = REQUIRED_KEYS.filter((k) => columns.has(k)).length;
    const score = SIGNATURE_KEYS.filter((k) => columns.has(k)).length;
    if (required > (best?.required ?? 0) || (required === best?.required && score > best.score)) best = { rowIndex, columns, score, required };
  });
  // Al menos dos columnas requeridas: con una sola (ej. FECHA) cualquier hoja parecería candidata.
  return best && (best as HeaderMatch).required >= 2 ? best : null;
}

const missingRequired = (h: HeaderMatch) => Object.values(REQUIRED).filter((name) => !h.columns.has(headerKey(name)));

/** Filas con datos debajo del encabezado (se omiten las vacías en todas las columnas que se leen). */
function dataRowIndexes(sheet: Sheet, h: HeaderMatch): number[] {
  const cols = [...Object.values(REQUIRED), ...Object.values(OPTIONAL)].map((name) => h.columns.get(headerKey(name))).filter((c) => c !== undefined);
  const out: number[] = [];
  for (let r = h.rowIndex + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    if (cols.some((c) => !isEmpty(row[c]))) out.push(r);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(year: number, month: number, day: number): SimpleDate | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate() ? { year, month, day } : null;
}

/**
 * Fecha y hora de la columna FECHA. Dropi la exporta como texto "31-08-2026 10:19";
 * también se aceptan fechas nativas de Excel, "31/08/2026" y "2026-08-31 10:19".
 */
export function parseDateTime(cell: Cell | undefined): { date: SimpleDate; time?: string } | null {
  if (!cell) return null;
  if (cell.t === "n") {
    const date = fromExcelSerial(cell.v);
    if (!date) return null;
    const minutes = Math.round((cell.v - Math.floor(cell.v)) * 1440) % 1440;
    return { date, time: minutes > 0 ? `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` : undefined };
  }
  if (cell.t !== "s" && cell.t !== "d") return null;
  const text = cell.v.trim();
  const time = /[\sT](\d{1,2}):(\d{2})/.exec(text);
  const hhmm = time ? `${pad(+time[1])}:${time[2]}` : undefined;
  const day = text.split(/[\sT]/)[0];
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(day);
  let date = m ? validDate(+m[3], +m[2], +m[1]) : null;
  if (!m) {
    m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(day);
    date = m ? validDate(+m[1], +m[2], +m[3]) : null;
  }
  return date ? { date, time: hhmm } : null;
}

function monthPeriod(keys: string[]): string | undefined {
  if (keys.length === 0) return undefined;
  const sorted = [...keys].sort();
  const [min, max] = [sorted[0], sorted[sorted.length - 1]];
  if (min.slice(0, 7) === max.slice(0, 7)) {
    const month = MONTHS_ES[+min.slice(5, 7) - 1];
    return `${month[0]}${month.slice(1).toLowerCase()} ${min.slice(0, 4)}`;
  }
  const show = (k: string) => `${k.slice(8)}/${k.slice(5, 7)}/${k.slice(0, 4)}`;
  return `${show(min)} a ${show(max)}`;
}

function extract(workbook: Workbook, sheet: Sheet, h: HeaderMatch, sheetReason: string): ParsedWalletFile {
  const col = (name: string) => h.columns.get(headerKey(name));
  const at = (row: Cell[], name: string) => {
    const c = col(name);
    return c === undefined ? undefined : row[c];
  };

  const movements: WalletMovement[] = [];
  for (const r of dataRowIndexes(sheet, h)) {
    const row = sheet.rows[r];
    const dateCell = at(row, REQUIRED.date);
    const parsed = parseDateTime(dateCell);
    const amountCell = at(row, REQUIRED.amount);
    // Vacío también es inválido: moneyCents lo trataría como 0.
    const amountCents = isEmpty(amountCell) ? null : moneyCents(amountCell);
    const conceptCell = at(row, REQUIRED.concept);

    movements.push({
      rowNumber: r + 1,
      id: cellText(at(row, OPTIONAL.id)),
      date: parsed ? `${pad(parsed.date.day)}/${pad(parsed.date.month)}/${parsed.date.year}` : cellText(dateCell),
      time: parsed?.time,
      dateKey: parsed ? `${parsed.date.year}-${pad(parsed.date.month)}-${pad(parsed.date.day)}` : "",
      type: cellText(at(row, OPTIONAL.type)),
      amountCents,
      amountText: cellText(amountCell),
      description: cellText(at(row, REQUIRED.description)),
      // El concepto se conserva tal cual (sin recortar ni cambiar mayúsculas).
      concept: conceptCell?.t === "s" ? conceptCell.v : cellText(conceptCell),
    });
  }

  if (movements.length === 0) throw new WalletHistoryError(`La hoja «${sheet.name}» tiene los encabezados del historial de cartera, pero no contiene movimientos.`);

  return {
    fileName: workbook.fileName,
    sheetName: sheet.name,
    sheetReason,
    ignoredSheets: workbook.sheets.filter((s) => s !== sheet).map((s) => s.name),
    hasId: col(OPTIONAL.id) !== undefined,
    hasType: col(OPTIONAL.type) !== undefined,
    movements,
    period: monthPeriod(movements.map((m) => m.dateKey).filter(Boolean)),
  };
}

function assertColumns(header: HeaderMatch) {
  const missing = missingRequired(header);
  if (missing.length === 1) throw new WalletHistoryError(`El archivo no contiene la columna «${missing[0]}».`);
  if (missing.length > 1) throw new WalletHistoryError(`El archivo no contiene las columnas ${missing.map((m) => `«${m}»`).join(", ")}.`);
}

/**
 * Identifica la hoja del historial de cartera por sus encabezados (no por el
 * nombre) y lee las columnas por nombre. Si varias hojas tienen la estructura,
 * usa la más completa; si empatan, el usuario elige.
 *
 * `sheetName` fuerza una hoja (cuando el usuario la eligió).
 */
export function readWalletWorkbook(workbook: Workbook, sheetName?: string): ReadResult {
  const matches = workbook.sheets.map((sheet) => ({ sheet, header: findHeader(sheet) })).filter((m) => m.header !== null) as { sheet: Sheet; header: HeaderMatch }[];

  if (sheetName !== undefined) {
    const chosen = matches.find((m) => m.sheet.name === sheetName);
    if (!chosen) throw new WalletHistoryError(`La hoja «${sheetName}» no tiene la estructura del historial de cartera de Dropi.`);
    assertColumns(chosen.header);
    return { kind: "ok", file: extract(workbook, chosen.sheet, chosen.header, "Seleccionada por el usuario.") };
  }

  if (matches.length === 0) throw new WalletHistoryError("No se encontró una hoja con la estructura del historial de cartera de Dropi (FECHA, MONTO, DESCRIPCIÓN y CONCEPTO DE RETIRO).");

  const complete = matches.filter((m) => missingRequired(m.header).length === 0);
  if (complete.length === 0) {
    // Se informa sobre la hoja que más se parece al historial.
    assertColumns([...matches].sort((a, b) => b.header.required - a.header.required || b.header.score - a.header.score)[0].header);
  }

  if (complete.length === 1) {
    const [only] = complete;
    const reason = matches.length === 1 ? "Única hoja con los encabezados del historial de cartera." : "Única hoja con todas las columnas requeridas.";
    return { kind: "ok", file: extract(workbook, only.sheet, only.header, reason) };
  }

  // Varias hojas: la de estructura más completa y, a igual estructura, la de más movimientos.
  const ranked = complete
    .map((m) => ({ ...m, rows: dataRowIndexes(m.sheet, m.header).length }))
    .sort((a, b) => b.header.score - a.header.score || b.rows - a.rows);
  const [first, second] = ranked;
  if (first.header.score === second.header.score && first.rows === second.rows) {
    return { kind: "choose-sheet", candidates: ranked.map((c) => ({ name: c.sheet.name, rows: c.rows })) };
  }
  const others = ranked
    .slice(1)
    .map((c) => `«${c.sheet.name}»`)
    .join(", ");
  const reason = `Tiene la estructura más completa del historial (${formatInteger(first.rows)} movimientos); también tienen las columnas requeridas: ${others}.`;
  return { kind: "ok", file: extract(workbook, first.sheet, first.header, reason) };
}
