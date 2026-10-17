import type { BatchInput, BatchSummary } from "../../../types/fs";
import type { CryptoModel } from "./domain/model";
import { blocking } from "./domain/problems";

export const eeffDedupeKey = (year: number) => `crypto:${year}`;

/** Huella del contenido que se envía: si coincide con la del lote vigente, Estados Financieros ya está al día. */
export function eeffFingerprint(input: Pick<BatchInput, "periodEnd" | "movements">): string {
  return JSON.stringify([input.periodEnd, input.movements.map((m) => [m.conceptKey, m.pucCode, m.amountCents, m.accountingDate])]);
}

/**
 * Lote anual de Transacciones Cripto para Estados Financieros: un movimiento por componente con valor. Null mientras haya
 * pendientes bloqueantes o ningún componente con valor. Siempre reemplaza al lote anterior del mismo año (`dedupeKey`).
 */
export function buildEeffBatch(companyId: number, model: CryptoModel): BatchInput | null {
  if (blocking(model.problems.eeff).length) return null;
  const { year, settings } = model;
  const movements = model.components
    .filter((c) => c.cents !== null && c.cents !== 0)
    .map((c) => ({
      accountingDate: settings.cutoff,
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
    periodLabel: `Transacciones Cripto · ${year} · corte ${settings.cutoff}`,
    periodStart: `${year}-01-01`,
    periodEnd: settings.cutoff,
    dedupeKey: eeffDedupeKey(year),
    movements,
  };
  return { ...input, metadata: { year, cutoff: settings.cutoff, presentation: settings.presentation, files: model.counts.files, fingerprint: eeffFingerprint(input) } };
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
  return sent === eeffFingerprint(built) ? "in_sync" : "update";
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
