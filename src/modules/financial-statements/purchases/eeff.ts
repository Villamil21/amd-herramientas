import type { BatchInput, BatchSummary } from "../../../types/fs";
import type { PurchasesModel } from "./domain/model";

/**
 * Lote anual de Compras, costos y exógena para Estados Financieros: un movimiento por línea de factura lista, con el PUC
 * confirmado de cada una. Solo costo, gasto o activo: nunca saldos por pagar ni retenciones. Siempre reemplaza al lote
 * anterior del mismo año (`dedupeKey`), así que reimportar o reclasificar no duplica.
 */

export const PURCHASES_SOURCE = "purchases" as const;

export const eeffDedupeKey = (year: number) => `purchases:${year}`;

/** Huella del contenido enviado: si coincide con la del lote vigente, Estados Financieros ya está al día. */
export function eeffFingerprint(input: Pick<BatchInput, "periodEnd" | "movements">): string {
  return JSON.stringify([input.periodEnd, input.movements.map((m) => [m.documentId, m.conceptKey, m.pucCode, m.amountCents, m.accountingDate, (m.detail as { line?: number } | undefined)?.line ?? 0])]);
}

export function buildEeffBatch(companyId: number, model: PurchasesModel): BatchInput | null {
  const { year, eeff } = model;
  if (year === null || eeff.movements.length === 0) return null;
  const input: BatchInput = {
    companyId,
    source: PURCHASES_SOURCE,
    fileName: `Compras, costos y exógena ${year}`,
    periodLabel: `Compras · ${year}`,
    periodStart: eeff.firstDate,
    periodEnd: eeff.lastDate,
    dedupeKey: eeffDedupeKey(year),
    movements: eeff.movements,
  };
  return {
    ...input,
    metadata: { year, documents: eeff.readyDocs, pendingDocuments: eeff.pendingDocs, pendingMonths: eeff.pendingMonths, fingerprint: eeffFingerprint(input) },
  };
}

export type EeffSyncState = "none" | "in_sync" | "update" | "empty";

/** Último lote vigente del año (el que alimenta Estados Financieros hoy). */
export const latestEeffBatch = (batches: readonly BatchSummary[], year: number) =>
  batches.filter((b) => b.source === PURCHASES_SOURCE && b.dedupeKey === eeffDedupeKey(year) && b.status === "active").sort((a, b) => b.id - a.id)[0];

/**
 * Qué hacer con el efecto en Estados Financieros. El primer envío es automático apenas hay una factura lista (la importación
 * no pide confirmar el envío: lo confirmado por línea es la clasificación). `empty`: había un lote y ya no queda nada que
 * enviar; no se retira solo (queda como alerta para que se decida).
 */
export function eeffSyncState(latest: Pick<BatchSummary, "metadata"> | undefined, built: BatchInput | null): EeffSyncState {
  if (!built) return latest ? "empty" : "none";
  if (!latest) return "update";
  const sent = (latest.metadata as { fingerprint?: string } | null)?.fingerprint;
  return sent === (built.metadata as { fingerprint?: string }).fingerprint ? "in_sync" : "update";
}

/**
 * Envío de la antigua «Clasificación contable de compras»: fuente `purchases` con clave distinta de `purchases:AAAA` y que no es
 * un registro «periodo sin actividad». Rust los anula al iniciar y al restaurar un backup; esta es la segunda barrera: aunque
 * alguno quedara activo, no alimenta el cálculo (el módulo nuevo empieza de cero).
 */
export const isLegacyPurchasesBatch = (b: Pick<BatchSummary, "source" | "dedupeKey" | "metadata">) =>
  b.source === PURCHASES_SOURCE && !b.dedupeKey.startsWith("purchases:") && !(b.metadata as { emptyPeriod?: unknown } | null)?.emptyPeriod;
