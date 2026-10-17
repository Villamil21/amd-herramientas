import type { BatchInput, BatchSummary } from "../../../types/fs";
import type { CryptoModel } from "./domain/model";
import { blocking } from "./domain/problems";

export const eeffDedupeKey = (year: number) => `crypto:${year}`;

/** Huella del contenido que se envía: si coincide con la del lote vigente, Estados Financieros ya está al día. */
export function eeffFingerprint(input: Pick<BatchInput, "periodEnd" | "movements">, cutoff = ""): string {
  return JSON.stringify([input.periodEnd, cutoff, input.movements.map((m) => [m.conceptKey, m.pucCode, m.amountCents, m.accountingDate])]);
}

/**
 * Lote anual de Transacciones Cripto para Estados Financieros: un movimiento por componente con valor. Null mientras haya
 * pendientes bloqueantes o ningún componente con valor. Siempre reemplaza al lote anterior del mismo año (`dedupeKey`).
 */
export function buildEeffBatch(companyId: number, model: CryptoModel): BatchInput | null {
  if (blocking(model.problems.eeff).length) return null;
  const { year, settings } = model;
  const effectiveDate = model.eeff.effectiveDate;
  const movements = model.components
    .filter((c) => c.cents !== null && c.cents !== 0)
    .map((c) => ({
      accountingDate: effectiveDate,
      conceptKey: `crypto.${c.key}`,
      documentId: `crypto:${year}:${c.key}`,
      documentNumber: String(year),
      documentType: c.label,
      pucCode: c.puc.code!,
      amountCents: c.cents!,
      description: `${c.label} · ${c.formula}`,
      detail: { formula: c.formula },
    }));
  if (movements.length === 0) return null;
  const input: BatchInput = {
    companyId,
    source: "crypto_ops",
    fileName: `Transacciones Cripto ${year}`,
    periodLabel: `Transacciones Cripto · ${year} · fechado al ${effectiveDate}`,
    periodStart: `${year}-01-01`,
    periodEnd: effectiveDate,
    dedupeKey: eeffDedupeKey(year),
    movements,
  };
  return { ...input, metadata: { year, cutoff: settings.cutoff, effectiveDate, presentation: settings.presentation, files: model.counts.files, fingerprint: eeffFingerprint(input, settings.cutoff) } };
}

export type EeffSyncState = "none" | "in_sync" | "update" | "retire" | "stale";

type CryptoBatchLike = Pick<BatchSummary, "id" | "status" | "metadata">;

/** El envío más reciente de un año (activo o retirado por desactualizado). */
export const latestEeffBatch = (batches: readonly BatchSummary[], year: number) =>
  batches.filter((b) => b.source === "crypto_ops" && b.dedupeKey === eeffDedupeKey(year) && (b.status === "active" || (b.status === "voided" && isStaleBatch(b)))).sort((a, b) => b.id - a.id)[0];

export const isStaleBatch = (b: Pick<BatchSummary, "metadata">) => Boolean((b.metadata as { stale?: unknown } | null)?.stale);

/**
 * Qué hacer con el efecto en Estados Financieros. Mientras nunca se haya enviado, el primer envío es manual (`none`). Desde
 * entonces cualquier cambio de origen (cargas, duplicados, corte, presentación, PUC…) lo actualiza solo (`update`). Si hay
 * pendientes que impiden recalcularlo, el envío vigente se retira del cálculo (`retire`, y luego `stale`): el lote se conserva
 * para auditoría pero deja de alimentar Estados Financieros hasta que se pueda recalcular con las fuentes actuales.
 */
export function eeffSyncState(latest: CryptoBatchLike | undefined, built: BatchInput | null): EeffSyncState {
  if (!latest) return "none";
  if (latest.status === "voided") return built ? "update" : "stale";
  if (!built) return "retire";
  const sent = (latest.metadata as { fingerprint?: string } | null)?.fingerprint;
  return sent === eeffFingerprint(built, String((built.metadata as { cutoff?: unknown } | null)?.cutoff ?? "")) ? "in_sync" : "update";
}

/** Años con el efecto retirado por desactualizado y no recalculado desde entonces: bloquean generar, cerrar y exportar. */
export function staleCryptoYears(batches: readonly BatchSummary[]): { year: number; reason: string }[] {
  const years = new Set(batches.filter((b) => b.source === "crypto_ops" && b.dedupeKey.startsWith("crypto:")).map((b) => Number(b.dedupeKey.slice(7))));
  const out: { year: number; reason: string }[] = [];
  for (const year of years) {
    const latest = latestEeffBatch(batches, year);
    if (latest?.status === "voided") out.push({ year, reason: String((latest.metadata as { staleReason?: unknown } | null)?.staleReason ?? "") });
  }
  return out.sort((a, b) => a.year - b.year);
}

export interface CryptoOutsideRange {
  year: number;
  /** Fecha contable con la que el lote fechó sus movimientos. */
  cutoff: string;
}

/**
 * Lotes vigentes cuyo corte cae fuera del rango del Generador. El Generador solo cuenta movimientos fechados dentro de su rango:
 * un lote fechado al 2026-05-31 no llega a un Generador que termina el 2026-04-30, y sin este aviso Ventas y Costo de ventas
 * quedarían en cero con el lote «al día».
 */
export function cryptoOutsideRange(batches: readonly BatchSummary[], start: string, end: string): CryptoOutsideRange[] {
  const out: CryptoOutsideRange[] = [];
  for (const b of batches) {
    if (b.source !== "crypto_ops" || b.status !== "active" || !b.dedupeKey.startsWith("crypto:")) continue;
    const year = Number(b.dedupeKey.slice(7));
    if (year < Number(start.slice(0, 4)) || year > Number(end.slice(0, 4))) continue;
    const meta = b.metadata as { effectiveDate?: unknown; cutoff?: unknown } | null;
    const cutoff = String(meta?.effectiveDate ?? meta?.cutoff ?? b.periodEnd ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(cutoff) && (cutoff < start || cutoff > end)) out.push({ year, cutoff });
  }
  return out.sort((a, b) => a.year - b.year);
}
