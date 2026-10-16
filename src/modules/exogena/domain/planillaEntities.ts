import type { BatchSummary } from "../../../types/fs";
import { digitsOnly } from "./text";

/**
 * Detalle por entidad de una planilla de seguridad social (resumen de pago): a quién se le debe cada aporte.
 * Se guarda en los metadatos del lote de Nómina (`fs_batches.metadata.entities`) al enviarlo a Estados Financieros.
 *
 * `liquidated` es SOLO el valor liquidado del aporte (en pesos): los intereses de mora, los fondos adicionales
 * (solidaridad / subsistencia), los recargos y el «valor a pagar» nunca entran.
 */
export type EntityType = "AFP" | "EPS" | "ARL" | "CCF" | "OTRO";

export interface PlanillaEntity {
  type: EntityType;
  name: string;
  /** Código de la administradora en la planilla (EPS010, CCF07, 14-11…). */
  code: string;
  nit: string;
  dv: string;
  /** Valor liquidado del aporte, en pesos enteros. */
  liquidated: number;
  /** Fecha de pago de la planilla (AAAA-MM-DD); null si aún no se pagó. */
  paymentDate: string | null;
  /** Período de pensión (AAAA-MM). */
  period: string;
}

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = { AFP: "Pensión (AFP)", EPS: "Salud (EPS)", ARL: "Riesgos laborales (ARL)", CCF: "Caja de compensación (CCF)", OTRO: "Otra entidad" };

const TYPES: EntityType[] = ["AFP", "EPS", "ARL", "CCF", "OTRO"];

/** Lee las entidades de un lote, ignorando lo que no tenga el formato esperado (lotes anteriores no las traen). */
export function readPlanillaEntities(batch: Pick<BatchSummary, "metadata">): PlanillaEntity[] {
  const raw = batch.metadata?.entities;
  if (!Array.isArray(raw)) return [];
  const out: PlanillaEntity[] = [];
  for (const e of raw as Record<string, unknown>[]) {
    if (!e || typeof e !== "object") continue;
    const type = TYPES.includes(e.type as EntityType) ? (e.type as EntityType) : "OTRO";
    const nit = digitsOnly(String(e.nit ?? ""));
    const liquidated = typeof e.liquidated === "number" && Number.isFinite(e.liquidated) ? Math.round(e.liquidated) : NaN;
    const period = typeof e.period === "string" ? e.period : "";
    if (!nit || Number.isNaN(liquidated) || !/^\d{4}-\d{2}$/.test(period)) continue;
    out.push({
      type,
      name: String(e.name ?? "").trim(),
      code: String(e.code ?? "").trim(),
      nit,
      dv: digitsOnly(String(e.dv ?? "")).slice(0, 1),
      liquidated,
      paymentDate: typeof e.paymentDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.paymentDate) ? e.paymentDate : null,
      period,
    });
  }
  return out;
}

/** Último día del período «AAAA-MM». */
export function periodEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * Una entidad de una planilla es deuda al corte cuando el período terminó a esa fecha y la planilla se pagó DESPUÉS
 * del corte o sigue pendiente. Si se pagó antes o el mismo día del corte, no es deuda.
 */
export function isPayableAtCut(entity: Pick<PlanillaEntity, "period" | "paymentDate">, cut: string): boolean {
  if (periodEnd(entity.period) > cut) return false;
  return entity.paymentDate === null || entity.paymentDate > cut;
}

/** Una administradora tal como la lee el lector de cada operador (sin fecha de pago ni período, que son de la planilla). */
export type RawPlanillaEntity = Pick<PlanillaEntity, "type" | "name" | "code" | "nit" | "dv" | "liquidated">;

/**
 * Detalle por entidad listo para guardar con el lote de Nómina. Si la suma por tipo no cuadra con el total que la propia
 * planilla informa para ese tipo, NO se guarda ninguna entidad (mejor sin detalle que con un detalle erróneo) y se explica por qué.
 */
export function planillaEntitiesFor(raw: RawPlanillaEntity[], expectedByType: Partial<Record<EntityType, number>>, period: string, paymentDate: string | null): { entities: PlanillaEntity[]; warning: string | null } {
  if (raw.length === 0) return { entities: [], warning: "La planilla no trae el detalle por entidad (nombre y NIT de cada administradora): el 1009 de Información Exógena no podrá detallar los aportes por pagar de esta planilla." };
  for (const [type, expected] of Object.entries(expectedByType) as [EntityType, number][]) {
    const sum = raw.filter((e) => e.type === type).reduce((n, e) => n + e.liquidated, 0);
    if (sum !== expected) {
      return { entities: [], warning: `El detalle por entidad de ${ENTITY_TYPE_LABEL[type]} suma $${sum.toLocaleString("es-CO")} y la planilla informa $${expected.toLocaleString("es-CO")}: no se guardó el detalle por entidad.` };
    }
  }
  return { entities: raw.map((e) => ({ ...e, nit: digitsOnly(e.nit), dv: digitsOnly(e.dv).slice(0, 1), name: e.name.trim(), code: e.code.trim(), paymentDate, period })), warning: null };
}
