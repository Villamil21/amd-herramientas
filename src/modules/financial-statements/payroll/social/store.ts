import type { BatchSummary, PayrollRow } from "../../../../types/fs";
import { PLANILLA_SCHEMA_VERSION, type NormalizedPlanilla } from "./types";

/**
 * Persistencia de una planilla v2: viaja en `fs_batches.metadata.planilla` (el lote sigue siendo la unidad de
 * auditoría, restauración y anulación). Los lotes sin `schemaVersion` son «legado»: se leen como antes y nunca se
 * reescriben en silencio.
 */

/** Identidad de la misma planilla: aportante + periodo + operador + número (o «sin-numero»). Otra planilla del periodo convive. */
export const dedupeKeyV2 = (p: Pick<NormalizedPlanilla, "employer" | "period" | "operator" | "planillaNumber">) =>
  `payroll:v2:${p.employer.nit}:${p.period}:${p.operator}:${p.planillaNumber ?? "sin-numero"}`;

export const moraDocumentIdV2 = (p: Pick<NormalizedPlanilla, "employer" | "period" | "operator" | "planillaNumber">) =>
  `planilla|${p.period}|${p.operator}|${p.employer.nit}|${p.planillaNumber ?? "sin-numero"}`;

/** Metadatos del lote v2. `entities` y `provider` conservan el formato que ya leen 1009 y las alertas de operador. */
export function planillaMetadata(p: NormalizedPlanilla, extra: Record<string, unknown>): Record<string, unknown> {
  return { ...extra, schemaVersion: PLANILLA_SCHEMA_VERSION, operator: p.operator, provider: p.operatorLabel, period: p.period, planilla: p };
}

export const isPlanillaBatch = (b: Pick<BatchSummary, "source" | "status" | "metadata">) => b.source === "payroll" && b.status === "active" && b.metadata?.provider !== undefined;

/** Planilla v2 guardada en un lote; `undefined` para lotes legado o con datos que no cumplen el formato. */
export function readPlanilla(batch: Pick<BatchSummary, "metadata">): NormalizedPlanilla | undefined {
  const raw = batch.metadata?.planilla as Partial<NormalizedPlanilla> | undefined;
  if (batch.metadata?.schemaVersion !== PLANILLA_SCHEMA_VERSION || !raw || !Array.isArray(raw.employees) || typeof raw.period !== "string") return undefined;
  return raw as NormalizedPlanilla;
}

export interface StoredPlanilla {
  batch: BatchSummary;
  /** `undefined` = lote legado: sin detalle por subsistema. */
  planilla?: NormalizedPlanilla;
}

/** Planillas activas de la empresa (v2 y legado), una por lote. */
export const storedPlanillas = (batches: BatchSummary[]): StoredPlanilla[] => batches.filter(isPlanillaBatch).map((batch) => ({ batch, planilla: readPlanilla(batch) }));

/**
 * Un lote legado y la planilla que se importa son la MISMA planilla si son del mismo operador y periodo y comparten
 * empleados: así el reenvío entra al flujo normal de duplicado/reemplazo en vez de chocar como «persona repetida».
 * Devuelve la llave de deduplicación del lote legado, o `undefined`.
 */
export function legacyDedupeKeyFor(p: NormalizedPlanilla, batches: BatchSummary[], rows: PayrollRow[], employeeIdByKey: Map<string, number>): string | undefined {
  const ids = new Set(p.employees.flatMap((e) => employeeIdByKey.get(`${e.docType} ${e.docNumber}`) ?? []));
  for (const b of batches) {
    if (!isPlanillaBatch(b) || readPlanilla(b) || b.metadata?.provider !== p.operatorLabel || b.metadata?.period !== p.period || !b.dedupeKey) continue;
    if (rows.some((r) => r.batchId === b.id && ids.has(r.employeeId))) return b.dedupeKey;
  }
  return undefined;
}

/** Clave estable «TIPO NÚMERO» de un empleado de la planilla. */
export const personKey = (docType: string, docNumber: string) => `${docType.toUpperCase()} ${docNumber}`;
