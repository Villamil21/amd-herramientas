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
  /** Días e IBC por subsistema (la fila los trae completos; antes solo se usaba pensión). `undefined` = el subsistema no aparece en la fila. */
  health?: SubsystemBase;
  risk?: SubsystemBase;
  ccf?: SubsystemBase;
  /** Parafiscales: Aportes en Línea los trae en UNA sola columna «SENA e ICBF» (no separa SENA de ICBF). */
  parafiscal?: SubsystemBase & { exonerated?: boolean };
  /** Código de la administradora de cada subsistema tal como lo imprime la fila (230301, EPS010, 14-11, CCF07). */
  entityCodes?: { afp?: string; eps?: string; arl?: string; ccf?: string };
  /** Códigos de novedad marcados en la fila (ing, ret, vsp, sln, ige, lma, vac, avp, vct, irl…). */
  novelties?: string[];
  /** Subsistemas cuyo código de entidad no se pudo leer de forma segura. */
  unreadCodes?: string[];
  page: number;
}

/** Días e IBC de un subsistema en la fila de un cotizante. */
export interface SubsystemBase {
  days?: number;
  ibc?: number;
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

/** Tipo de administradora de seguridad social. */
export type PaymentEntityType = "AFP" | "EPS" | "ARL" | "CCF" | "OTRO";

/**
 * Una administradora del «Resumen de pago» (a quién se le debe cada aporte). `liquidated` es SOLO el valor liquidado del
 * aporte: los intereses de mora, los fondos de solidaridad / subsistencia y el «valor a pagar» no entran.
 */
export interface PaymentEntity {
  type: PaymentEntityType;
  name: string;
  /** Código de la administradora en la planilla (EPS010, CCF07, 14-11…). */
  code: string;
  nit: string;
  dv: string;
  liquidated: number;
  /** Intereses de mora de la administradora (fuera del aporte liquidado). */
  lateInterest?: number;
  /** Fondo de Solidaridad y de Subsistencia (solo AFP) y sus intereses de mora: columnas aparte del aporte liquidado. */
  fspSolidarity?: number;
  fspSolidarityLate?: number;
  fspSubsistence?: number;
  fspSubsistenceLate?: number;
  /** «Saldos e incapacidades»: nunca es aporte liquidado. */
  incapacities?: number;
  /** «Valor a pagar» de la administradora. */
  toPay?: number;
}

/** Fila TOTAL y subtotales por riesgo del «Resumen de pago». */
export interface PaymentSummary {
  liquidated?: number;
  lateInterest?: number;
  toPay?: number;
  /** Valor liquidado por riesgo: AFP, EPS, CCF, ARL… */
  liquidatedByRisk: Record<string, number>;
  /** Administradoras con NIT y valor liquidado (vacío si la planilla no trae ese detalle). */
  entities?: PaymentEntity[];
}

/** Texto dentro de la tabla que parecía un empleado pero no se pudo interpretar. */
export interface PayrollIssue {
  page: number;
  text: string;
  reason: string;
}

/** Datos del aportante («DATOS GENERALES DEL APORTANTE»). */
export interface PayrollEmployer {
  nit: string;
  dv?: string;
  name?: string;
}

export interface PayrollSummary {
  provider: PayrollProvider;
  pageCount: number;
  /** Periodo de pensión, ej. "2026-01". */
  period: string;
  /** Periodo de salud (solo informativo; nunca se usa como periodo contable). */
  healthPeriod?: string;
  /** Aportante: su NIT identifica a la empresa. */
  employer?: PayrollEmployer;
  /** Número de la planilla (Clave → Planilla) cuando el PDF lo trae. */
  planillaNumber?: string;
  /** Tipo de planilla («E», «I»…). */
  planillaType?: string;
  /** Fecha de pago tal como aparece, ej. "2026/02/26". */
  paymentDate: string;
  /** Valor pagado. */
  paymentAmount: number;
  /** Total Aportes de la fila Total Afiliados. */
  totalContributions: number;
  /** Valor pagado − total aportes liquidados. */
  lateInterest: number;
  employeeCount: number;
  /** Filas de empleado detectadas en la tabla (interpretadas o no). */
  detectedRows: number;
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
