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
  /** Desglose de `pensionExtras`: aportes voluntarios (afiliado + aportante) y Fondo de Solidaridad / Subsistencia pensional. */
  voluntaryPension?: number;
  fspSolidarity?: number;
  fspSubsistence?: number;
  /** Días e IBC de los demás subsistemas (salud, riesgos y CCF); pensión es `pensionDays` / `pensionIbc`. */
  healthDays?: number;
  healthIbc?: number;
  riskDays?: number;
  riskIbc?: number;
  ccfDays?: number;
  ccfIbc?: number;
  /** Código de la administradora de cada subsistema tal como lo imprime la fila. */
  entityCodes?: { afp?: string; eps?: string; arl?: string; ccf?: string };
  /** Códigos de novedad marcados en la fila (ING, RET, VSP, SLN, IGE, LMA, VAC…), en minúscula. */
  novelties?: string[];
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

/** Una administradora (EPS, AFP, ARL, CCF) de una sección «Totales …» con su valor ANTES de mora (el aporte liquidado). */
export interface AdministratorRow {
  code: string;
  name: string;
  nit: string;
  dv: string;
  contribution: number;
}

/** Suma de las filas de administradoras (EPS, AFP, ARL, CCF) de cada sección «Totales …». */
export interface AdministratorSums {
  contribution?: number;
  toPay?: number;
  rows: number;
  /** Cada administradora con NIT; vacío si la tabla no trae el nombre y el NIT. */
  entities?: AdministratorRow[];
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
