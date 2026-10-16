/**
 * MiPlanilla (Planilla Integrada de Autoliquidación de Aportes): tipos propios del operador.
 * Todos los importes son pesos enteros (la PILA no tiene centavos).
 */

export type Parafiscal = "sena" | "icbf" | "esap" | "men";
export const PARAFISCALS: Parafiscal[] = ["sena", "icbf", "esap", "men"];
export const PARAFISCAL_LABEL: Record<Parafiscal, string> = { sena: "SENA", icbf: "ICBF", esap: "ESAP", men: "MEN" };

export interface MiPlanillaEmployee {
  /** Número de la fila en el detalle por cotizante. */
  rowNumber: number;
  /** Tipo y número de documento, ej. «CC 1020713259». */
  identification: string;
  name: string;
  pensionDays: number;
  pensionIbc: number;
  pensionContribution: number;
  healthContribution: number;
  riskContribution: number;
  ccfContribution: number;
  /** Aportes voluntarios y al FSP de pensión: no tienen tratamiento contable (se informan, no se suman). */
  pensionExtras: number;
  parafiscales: Record<Parafiscal, number>;
  page: number;
}

/** Cotización de un empleado: pensión + salud + riesgos laborales + CCF (los parafiscales y la mora no entran). */
export const cotizacionOf = (e: Pick<MiPlanillaEmployee, "pensionContribution" | "healthContribution" | "riskContribution" | "ccfContribution">) =>
  e.pensionContribution + e.healthContribution + e.riskContribution + e.ccfContribution;

export type Subsystem = "health" | "pension" | "risk" | "ccf";
export const SUBSYSTEM_LABEL: Record<Subsystem, string> = { health: "Salud", pension: "Pensión", risk: "Riesgos laborales", ccf: "CCF" };

/** Valores de un subsistema o parafiscal en «Totales por subsistema» (antes de mora y a pagar). */
export interface SubsystemTotal {
  administrators?: number;
  /** «Valor antes de IGE, LMA, IRP y Mora». */
  contribution?: number;
  toPay?: number;
}

export interface MiPlanillaTotals {
  subsystems: Partial<Record<Subsystem, SubsystemTotal>>;
  parafiscales: Partial<Record<Parafiscal, SubsystemTotal>>;
  grand?: SubsystemTotal;
}

/** Suma de las filas de administradoras (EPS, AFP, ARL, CCF) de cada sección «Totales …». */
export interface AdministratorSums {
  contribution?: number;
  toPay?: number;
  rows: number;
}

export interface MiPlanillaIssue {
  page: number;
  text: string;
  reason: string;
}

export interface MiPlanillaSummary {
  pageCount: number;
  employerNit?: string;
  employerDv?: string;
  employerName?: string;
  planillaNumber?: string;
  /** Fecha de pago en ISO (AAAA-MM-DD). */
  paymentDate?: string;
  /** Período de PENSIÓN: es el único período de nómina. */
  pensionPeriod: string;
  /** Solo informativo: nunca se usa como período contable. */
  healthPeriod?: string;
  planillaType?: string;
  declaredEmployees?: number;
  totalPayroll?: number;
  /** Valor total a pagar del encabezado. */
  totalToPay?: number;
  employees: MiPlanillaEmployee[];
  totals: MiPlanillaTotals;
  administrators: Partial<Record<Subsystem, AdministratorSums>>;
  /** Filas del detalle detectadas (interpretadas o no). */
  detectedRows: number;
  issues: MiPlanillaIssue[];
}

export type CheckStatus = "ok" | "failed" | "unavailable";

export interface MiPlanillaCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}
