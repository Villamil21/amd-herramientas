import type { Cell } from "../types/excel";

export interface SimpleDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export const MONTHS_ES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

function valid(year: number, month: number, day: number): SimpleDate | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth ? { year, month, day } : null;
}

/** Número de serie de Excel (sistema 1900) → fecha. */
export function fromExcelSerial(serial: number): SimpleDate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Fecha desde una celda. Acepta fechas nativas de Excel, AAAA-MM-DD y
 * DD-MM-AAAA / DD/MM/AAAA (formato colombiano; puede traer hora al final).
 */
export function cellDate(cell: Cell | undefined): SimpleDate | null {
  if (!cell) return null;
  if (cell.t === "n") return fromExcelSerial(cell.v);
  if (cell.t !== "s" && cell.t !== "d") return null;
  const text = cell.v.trim().split(/[\sT]/)[0];
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}

export function compareDates(a: SimpleDate, b: SimpleDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** 01-MARZO-2026 */
export function formatDateLong(d: SimpleDate): string {
  return `${pad(d.day)}-${MONTHS_ES[d.month - 1]}-${d.year}`;
}

/** 30-04-2026 */
export function formatDateShort(d: SimpleDate): string {
  return `${pad(d.day)}-${pad(d.month)}-${d.year}`;
}

/** 2026-04 */
export function formatYearMonth(d: SimpleDate): string {
  return `${d.year}-${pad(d.month)}`;
}

/** Fecha y hora local en formato AAAA-MM-DD HH:mm:ss. */
export function formatDateTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export interface Period {
  start: SimpleDate;
  end: SimpleDate;
  label: string;
}

/** Inicio = primer día del mes de la fecha mínima; fin = fecha máxima. */
export function taxablePeriod(min: SimpleDate, max: SimpleDate): Period {
  const start = { year: min.year, month: min.month, day: 1 };
  return { start, end: max, label: `${formatDateLong(start)} A ${formatDateLong(max)}` };
}
