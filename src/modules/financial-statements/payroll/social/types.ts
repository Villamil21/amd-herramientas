/**
 * Modelo único de una planilla de seguridad social. Cada operador (Aportes en Línea, MiPlanilla, SOI…) tiene un
 * adaptador que convierte su PDF en una `NormalizedPlanilla`; de aquí en adelante (persistencia, Estados Financieros,
 * formatos 1001, 1011 y 2276) nada depende del operador. Importes en pesos enteros (la PILA no tiene centavos).
 */

import { StatementError } from "../../../bank-analysis/shared/types";

export type OperatorId = "aportes-en-linea" | "miplanilla" | "soi";

export const OPERATOR_LABEL: Record<OperatorId, string> = {
  "aportes-en-linea": "Aportes en Línea",
  miplanilla: "MiPlanilla",
  soi: "SOI",
};

/** Versión del modelo guardado en `fs_batches.metadata.schemaVersion`. Un lote sin ella es «legado». */
export const PLANILLA_SCHEMA_VERSION = 2;

/** Subsistemas y parafiscales con tratamiento contable. */
export type ContributionKind = "pension" | "health" | "arl" | "ccf" | "sena" | "icbf";
export const CONTRIBUTION_KINDS: ContributionKind[] = ["pension", "health", "arl", "ccf", "sena", "icbf"];

/** Tipo de administradora. SENA e ICBF son entidades propias (no el CCF). */
export type EntityKind = "AFP" | "EPS" | "ARL" | "CCF" | "SENA" | "ICBF";

export interface SubsystemBase {
  days?: number;
  ibc?: number;
}

export interface NormalizedEmployee {
  docType: string;
  docNumber: string;
  name: string;
  pension: SubsystemBase;
  health: SubsystemBase;
  risk: SubsystemBase;
  ccf: SubsystemBase;
  /** Aporte liquidado por empleado (sin mora, recargos ni total a pagar). */
  contributions: Record<ContributionKind, number>;
  /** Parafiscales que la planilla trae pero no tienen tratamiento contable (ESAP, MEN, «SENA e ICBF» sin separar). Clave = nombre exacto. */
  unrecognized: Record<string, number>;
  /** Fondo de Solidaridad / Subsistencia pensional y aportes voluntarios (informativos). */
  pensionExtras?: { solidarity?: number; subsistence?: number; voluntary?: number };
  /** Código de cada administradora tal como lo imprime la planilla. */
  entityCodes: { afp?: string; eps?: string; arl?: string; ccf?: string };
  novelties: string[];
  /** Subsistemas cuyo código de entidad no se pudo leer. */
  unreadCodes: string[];
  /** Evidencia: página y fila del PDF. */
  page: number;
  row: number;
  /** Tramos de la misma planilla consolidados en este empleado (misma identificación, varias filas). Trazabilidad: no se suman de nuevo. */
  segments?: Omit<NormalizedEmployee, "segments">[];
}

export interface NormalizedEntity {
  kind: EntityKind;
  code: string;
  name: string;
  nit: string;
  dv: string;
  /** SOLO el aporte liquidado. */
  liquidated: number;
  lateInterest?: number;
  /** Fondo de solidaridad / subsistencia (solo AFP): columnas aparte. */
  fsp?: number;
}

export interface PlanillaIssue {
  page: number;
  text: string;
  reason: string;
}

export interface PlanillaCheck {
  id: string;
  label: string;
  status: "ok" | "failed" | "unavailable";
  detail?: string;
}

export interface NormalizedPlanilla {
  schemaVersion: typeof PLANILLA_SCHEMA_VERSION;
  operator: OperatorId;
  operatorLabel: string;
  /** Número de planilla en el operador. */
  planillaNumber?: string;
  planillaType?: string;
  employer: { nit: string; dv?: string; name?: string };
  /** Período de PENSIÓN (AAAA-MM): el único período contable. */
  period: string;
  /** Solo informativo. */
  healthPeriod?: string;
  /** Fecha de pago ISO: solo trazabilidad. */
  paymentDate: string | null;
  employees: NormalizedEmployee[];
  entities: NormalizedEntity[];
  /** Mora global de la planilla (nunca es aporte). */
  lateInterest: number;
  issues: PlanillaIssue[];
  checks: PlanillaCheck[];
  /** Avisos que no bloquean. */
  warnings: string[];
  pageCount: number;
  /** Archivo de origen (evidencia); lo completa quien importa. */
  fileName?: string;
  fileHash?: string;
}

export class PlanillaDetectionError extends StatementError {}
