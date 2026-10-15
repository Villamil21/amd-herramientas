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

/** 30/04/2026 */
export function formatDateShort(d: SimpleDate): string {
  return `${pad(d.day)}/${pad(d.month)}/${d.year}`;
}

/** 2026-04 */
export function formatYearMonth(d: SimpleDate): string {
  return `${d.year}-${pad(d.month)}`;
}

/** Fecha y hora local en formato DD/MM/AAAA HH:mm:ss. */
export function formatDateTime(date: Date): string {
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
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

// ---------------------------------------------------------------------------
// Regla única de fechas de la aplicación
//   Persistencia / lógica interna → AAAA-MM-DD (ISO)
//   Interfaz para el usuario      → DD/MM/AAAA
// ---------------------------------------------------------------------------

const MONTHS_LOWER_ES = MONTHS_ES.map((m) => m.toLowerCase());

/** Fecha civil → «AAAA-MM-DD». */
export const toIsoDate = (d: SimpleDate) => `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;

/** «AAAA-MM-DD» válido y existente → fecha civil (sin pasar por Date ni zonas horarias). */
export function fromIsoDate(iso: string | null | undefined): SimpleDate | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? valid(+m[1], +m[2], +m[3]) : null;
}

/**
 * Cualquier fecha técnica → «DD/MM/AAAA» para mostrar.
 * - «AAAA-MM-DD» o «AAAA/MM/DD» (con hora opcional, que se conserva tal cual).
 * - Marca de tiempo con zona («…T14:35:00Z» o con desfase): se muestra la fecha y hora LOCAL,
 *   para no correr el día por la conversión UTC.
 * Lo que no se reconoce se devuelve sin cambios; vacío → `fallback`.
 */
export function formatDateForDisplay(value: string | null | undefined, fallback = "—"): string {
  const text = value?.trim();
  if (!text) return fallback;
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) return formatLocalDate(d);
  }
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](.*))?$/.exec(text);
  if (!m) return text;
  const time = m[4]?.trim();
  return `${pad(+m[3])}/${pad(+m[2])}/${m[1]}${time ? ` ${time}` : ""}`;
}

/** Marca de tiempo con zona → «DD/MM/AAAA HH:mm» (o «HH:mm:ss») en hora local. */
export function formatDateTimeForDisplay(value: string | Date | null | undefined, { seconds = false, fallback = "—" } = {}): string {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? formatDateForDisplay(value, fallback) : fallback;
  return `${formatLocalDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ""}`;
}

/** Día local de un `Date` → «DD/MM/AAAA». */
export const formatLocalDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

/** «AAAA-MM-DD» → valor para un campo de fecha («DD/MM/AAAA»; vacío si no es una fecha). */
export const formatDateForInput = (iso: string | null | undefined) => (fromIsoDate(iso) ? formatDateForDisplay(iso) : "");

/**
 * Texto escrito por el usuario «DD/MM/AAAA» → «AAAA-MM-DD», o null si no es una fecha real.
 * Siempre día primero: «05/10/2026» es el 5 de octubre. Acepta «/», «-» o «.» y día/mes de un dígito.
 */
export function parseDisplayDate(value: string | null | undefined): string | null {
  const m = value ? /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value.trim()) : null;
  const d = m ? valid(+m[3], +m[2], +m[1]) : null;
  return d ? toIsoDate(d) : null;
}

/**
 * Excepción solo para la fecha de pago de impuestos (Obligaciones tributarias):
 * además de «DD/MM/AAAA» acepta 8 dígitos pegados, que se leen SIEMPRE como AAAAMMDD
 * («20260429» → «2026-04-29»). No usar en el resto de la aplicación.
 */
export function parseTaxPaymentDate(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (m) {
    const d = valid(+m[1], +m[2], +m[3]);
    return d ? toIsoDate(d) : null;
  }
  return parseDisplayDate(text);
}

/** «2026-09-30» → «30 de septiembre de 2026». */
export function formatDateText(iso: string | null | undefined, fallback = "—"): string {
  const d = fromIsoDate(iso);
  return d ? `${d.day} de ${MONTHS_LOWER_ES[d.month - 1]} de ${d.year}` : fallback;
}
