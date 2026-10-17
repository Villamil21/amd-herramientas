import type { Operation } from "./operations";
import type { CryptoUpload } from "./types";

/**
 * Cobertura mensual. Los meses de una carga se derivan de las compras ACEPTADAS de Compras.Fecha (las excluidas, las de otro año y las pendientes no cubren nada: las pendientes se muestran aparte);
 * Ventas no trae fecha: sus ingresos pertenecen al período que cubren las compras de esa misma carga. El usuario puede ajustar
 * el período de una carga cuando el derivado no refleja lo que realmente contiene.
 */
export interface UploadCoverage {
  uploadId: number;
  fileName: string;
  /** Meses AAAA-MM realmente cubiertos: los elegidos (ajuste o derivados de compras aceptadas) sin filas pendientes. */
  months: string[];
  /** Lo elegido antes de descontar los meses con pendientes (es lo que edita el ajuste manual). */
  selected: string[];
  /** Meses con al menos una compra aceptada. */
  derived: string[];
  /** Meses con filas pendientes por resolver, con su cantidad y motivo. */
  pendingMonths: PendingMonth[];
  unmonthed: UnmonthedPending;
  overridden: boolean;
  first: string | null;
  last: string | null;
}

export const monthOf = (date: string) => date.slice(0, 7);

/** Filas pendientes de un mes: cuántas son y por qué no cuentan todavía. */
export interface PendingMonth {
  month: string;
  count: number;
  reasons: { reason: string; count: number }[];
}

const REASON_LABEL = { duplicate: "posible duplicado", amount: "valor ilegible o vacío" } as const;

/** Motivo principal por el que una compra con fecha dentro del año sigue pendiente. */
function pendingReason(o: Operation): string {
  if (o.issues.some((i) => i.code === "amount")) return REASON_LABEL.amount;
  if (o.issues.some((i) => i.code === "duplicate")) return REASON_LABEL.duplicate;
  return "pendiente de revisión";
}

/** Pendientes que no se pueden atribuir a un mes: compras de otro año o con fecha ilegible, y ventas (no traen fecha). */
export interface UnmonthedPending {
  outOfYear: number;
  unreadableDate: number;
  sales: number;
}

export function uploadCoverage(upload: Pick<CryptoUpload, "id" | "fileName" | "coverageOverride">, operations: readonly Operation[], year: number): UploadCoverage {
  const own = operations.filter((o) => o.uploadId === upload.id);
  const inYear = (o: Operation) => o.kind === "purchase" && !!o.date && Number(o.date.slice(0, 4)) === year;
  // Un mes solo se deriva de compras ACEPTADAS; las pendientes se listan aparte y las excluidas no cuentan.
  const derived = [...new Set(own.filter((o) => inYear(o) && o.status === "accepted").map((o) => monthOf(o.date!)))].sort();

  const byMonth = new Map<string, Map<string, number>>();
  for (const o of own.filter((o) => inYear(o) && o.status === "pending")) {
    const reasons = byMonth.get(monthOf(o.date!)) ?? new Map<string, number>();
    const r = pendingReason(o);
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
    byMonth.set(monthOf(o.date!), reasons);
  }
  const pendingMonths: PendingMonth[] = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, reasons]) => ({ month, count: [...reasons.values()].reduce((a, b) => a + b, 0), reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })) }));
  const pending = own.filter((o) => o.status === "pending");
  const unmonthed: UnmonthedPending = {
    outOfYear: pending.filter((o) => o.kind === "purchase" && !!o.date && Number(o.date.slice(0, 4)) !== year).length,
    unreadableDate: pending.filter((o) => o.kind === "purchase" && !o.date).length,
    sales: pending.filter((o) => o.kind === "sale").length,
  };

  const overridden = !!upload.coverageOverride?.length;
  // Lo elegido (ajuste del usuario o derivado) y lo realmente cubierto: un mes con filas pendientes no está cubierto hasta que se acepten o excluyan.
  const selected = overridden ? [...upload.coverageOverride!].sort() : derived;
  const blockedMonths = new Set(pendingMonths.map((p) => p.month));
  const months = selected.filter((m) => !blockedMonths.has(m));
  return { uploadId: upload.id, fileName: upload.fileName, months, selected, derived, overridden, first: months[0] ?? null, last: months[months.length - 1] ?? null, pendingMonths, unmonthed };
}

export const yearMonths = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

/** Qué archivos aportan cada mes del año; una superposición no es un error por sí sola. */
export interface MatrixMonth {
  month: string;
  uploads: UploadCoverage[];
  pending: { fileName: string; pending: PendingMonth }[];
}

export function coverageMatrix(year: number, coverages: readonly UploadCoverage[]): MatrixMonth[] {
  return yearMonths(year).map((month) => ({
    month,
    uploads: coverages.filter((c) => c.months.includes(month)),
    pending: coverages.flatMap((c) => c.pendingMonths.filter((p) => p.month === month).map((pending) => ({ fileName: c.fileName, pending }))),
  }));
}

/** Meses del año sin ninguna carga. */
export const missingMonths = (year: number, coverages: readonly UploadCoverage[]) => coverageMatrix(year, coverages).filter((m) => m.uploads.length === 0).map((m) => m.month);
