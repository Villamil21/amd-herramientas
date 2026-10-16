/**
 * Utilidades de valores y fechas de Estados Financieros.
 *
 * Los valores se guardan y suman en centavos exactos. El redondeo al millar es
 * solo de presentación: los totales se calculan con valores exactos y luego se
 * redondean (nunca se suman cifras ya redondeadas).
 */

import { formatDateForDisplay } from "../../../utils/dates";

/** Centavos → pesos redondeados al millar (mitad hacia afuera: 3.566.500 → 3.567.000; −3.566.500 → −3.567.000). */
export function roundThousands(cents: number): number {
  const thousands = Math.abs(cents) / 100_000;
  const rounded = Math.round(thousands) * 1000;
  return cents < 0 && rounded !== 0 ? -rounded : rounded;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Pesos enteros para los estados: 3.566.000 · negativos entre paréntesis: ($2.000.000) · cero: «-». */
export function formatStatementPesos(pesos: number): string {
  if (pesos === 0) return "-";
  const text = `$${group(String(Math.abs(Math.round(pesos))))}`;
  return pesos < 0 ? `(${text})` : text;
}

/** Centavos exactos para la app: $ 3.566.281,25 (con signo menos). */
export function formatExactCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${negative ? "-" : ""}$ ${group(String(Math.floor(abs / 100)))},${String(abs % 100).padStart(2, "0")}`;
}

/** Formato contable de la app: negativos entre paréntesis, «($ 48.605.000,00)». */
export const formatAccountingCents = (cents: number) => (cents < 0 ? `(${formatExactCents(-cents)})` : formatExactCents(cents));

/** Impuesto de renta estimado (solo en la app): 35 % del resultado positivo, redondeado al millar. */
export function estimatedIncomeTax(resultCents: number): number {
  return resultCents <= 0 ? 0 : roundThousands(resultCents * 0.35);
}

// ---------------------------------------------------------------------------
// Fechas ISO (AAAA-MM-DD) sin zonas horarias
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

export const isIsoDate = (value: string | undefined | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** «2026/08/31» → «2026-08-31». */
export const slashToIso = (value: string | undefined): string | undefined => {
  const m = value ? /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim()) : null;
  return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : undefined;
};

export function lastDayOfMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${period.slice(0, 7)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** Meses (AAAA-MM) entre dos fechas, ambos inclusive. */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.slice(0, 7).split("-").map(Number);
  const [ey, em] = end.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** «2026-08» → «Agosto 2026». */
export const periodLabel = (period: string) => `${MONTH_NAMES[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

/** «a», «a y b», «a, b y c». */
const joinSpanish = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`);

/**
 * Meses detectados (AAAA-MM, en cualquier orden y con repetidos) en texto:
 * «Enero 2026», «Enero a marzo de 2026», «Enero, marzo y mayo de 2026»,
 * «Diciembre 2025 a enero 2026». Vacío si no hay meses.
 */
export function describeMonths(months: string[]): string {
  const list = [...new Set(months)].sort();
  if (list.length === 0) return "";
  if (list.length === 1) return periodLabel(list[0]);
  const name = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1].toLowerCase();
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const first = list[0];
  const last = list[list.length - 1];
  const consecutive = monthsBetween(`${first}-01`, `${last}-01`).length === list.length;
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  if (consecutive) return sameYear ? `${capital(name(first))} a ${name(last)} de ${first.slice(0, 4)}` : `${periodLabel(first)} a ${name(last)} ${last.slice(0, 4)}`;
  if (sameYear) return `${capital(joinSpanish(list.map(name)))} de ${first.slice(0, 4)}`;
  return capital(joinSpanish(list.map((m) => `${name(m)} ${m.slice(0, 4)}`)));
}

/** «2026-08-31» → «31/08/2026» (regla única de la aplicación, ver utils/dates). */
export const formatIsoDate = (iso: string) => formatDateForDisplay(iso);

/** «2026-01-01» → «01 ENERO 2026» (encabezado de los estados). */
export const statementDate = (iso: string) => `${iso.slice(8, 10)} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1].toUpperCase()} ${iso.slice(0, 4)}`;

/** Hoy en hora local, AAAA-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Huella corta y estable de un texto (cyrb53): para detectar cambios en valores validados. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
