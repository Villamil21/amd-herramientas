/**
 * Tipos comunes del Resumen de planilla. Cada proveedor (Aportes en Línea,
 * más adelante Mi Planilla) convierte su PDF en un PayrollSummary; resumen,
 * validación, tabla y exportación trabajan solo con estos tipos.
 *
 * Todos los importes están en pesos enteros (las planillas PILA no tienen
 * centavos), para sumar sin errores.
 */

export type PayrollProvider = "aportes-en-linea";

export interface PayrollEmployee {
  /** Número de la fila en la planilla (columna No.). */
  rowNumber: number;
  /** Tipo y número de documento, ej. "CC 1192816998". */
  identification: string;
  name: string;
  pensionDays: number;
  pensionIbc: number;
  pensionContribution: number;
  healthContribution: number;
  ccfContribution: number;
  riskContribution: number;
  totalContribution: number;
  /** Aporte de parafiscales (SENA/ICBF). No se muestra: solo valida que la fila sume su total. */
  otherContribution?: number;
  page: number;
}

/** Fila «Total Afiliados(n)» al final de la liquidación detallada. */
export interface PayrollDetailTotals {
  declaredEmployees?: number;
  pensionIbc?: number;
  pensionContribution?: number;
  healthContribution?: number;
  ccfContribution?: number;
  riskContribution?: number;
  totalContribution?: number;
}

/** Fila TOTAL y subtotales por riesgo del «Resumen de pago» (segunda página). */
export interface PaymentSummary {
  liquidated?: number;
  lateInterest?: number;
  toPay?: number;
  /** Valor liquidado por riesgo: AFP, EPS, CCF, ARL… */
  liquidatedByRisk: Record<string, number>;
}

/** Texto dentro de la tabla que parecía un empleado pero no se pudo interpretar. */
export interface PayrollIssue {
  page: number;
  text: string;
  reason: string;
}

export interface PayrollSummary {
  provider: PayrollProvider;
  pageCount: number;
  /** Periodo de pensión, ej. "2026-01". */
  period: string;
  /** Fecha de pago tal como aparece, ej. "2026/02/26". */
  paymentDate: string;
  /** Valor pagado. */
  paymentAmount: number;
  /** Total Aportes de la fila Total Afiliados. */
  totalContributions: number;
  /** Valor pagado − total aportes liquidados. */
  lateInterest: number;
  employeeCount: number;
  employees: PayrollEmployee[];
  detailTotals: PayrollDetailTotals;
  paymentSummary?: PaymentSummary;
  issues: PayrollIssue[];
  /** Nombres reconstruidos a partir de varias líneas del PDF. */
  joinedNames: number;
}

export type CheckStatus = "ok" | "failed" | "unavailable";

export interface PayrollCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface PayrollValidation {
  /** true solo si todos los controles pasaron y no hubo filas sin interpretar. */
  validated: boolean;
  checks: PayrollCheck[];
}

export interface PayrollAnalysis {
  summary: PayrollSummary;
  validation: PayrollValidation;
}
