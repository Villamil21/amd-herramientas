import { SEVERITY_ORDER, type DestCounts, type DestStatus, type Severity, destStatus, emptyCounts } from "../../purchases/domain/status";

/**
 * Alertas de Nómina y seguridad social por destino. Cada una dice qué falta, por qué afecta a ESE destino y abre el dato que la
 * resuelve. Un pendiente de un destino nunca detiene a los demás: la severidad se cuenta solo en `dests`.
 */
export type PayrollDest = "EEFF" | "1001" | "1011" | "2276";

export const PAYROLL_DESTS: PayrollDest[] = ["EEFF", "1001", "1011", "2276"];

export const PAYROLL_DEST_LABEL: Record<PayrollDest, string> = {
  EEFF: "Estados Financieros",
  "1001": "Formato 1001",
  "1011": "Formato 1011",
  "2276": "Formato 2276",
};

export interface PayrollAlert {
  /** Estable entre cálculos. */
  id: string;
  /** Tipo (agrupa las repetidas). */
  code: string;
  severity: Severity;
  dests: PayrollDest[];
  title: string;
  /** Qué falta y por qué afecta a esos destinos. */
  why: string;
  /** Cómo resolverlo. */
  how: string;
  /** Abre directamente el empleado, proveedor, empresa, planilla o entidad que lo resuelve. */
  action?: { label: string; path: string };
}

// --- Rutas que resuelven una alerta -------------------------------------------------------------------------------

export const NOMINA_PATH = "/herramientas/estados-financieros/nomina";
export const EMPLOYEES_PATH = "/herramientas/estados-financieros/empleados";
/** Abre la ficha de un empleado (el enrutador guarda el foco y lleva a Empleados). */
export const employeePath = (companyId: number, docType: string, docNumber: string) => `${EMPLOYEES_PATH}/${companyId}~${encodeURIComponent(docType)}~${encodeURIComponent(docNumber)}`;
export const companyPath = (nit: string) => `/empresas/${nit}`;
export const supplierPath = (nit: string) => `/proveedores/${nit}`;

export function payrollCounts(alerts: readonly PayrollAlert[]): Record<PayrollDest, DestCounts> {
  const out = Object.fromEntries(PAYROLL_DESTS.map((d) => [d, emptyCounts()])) as Record<PayrollDest, DestCounts>;
  for (const a of alerts) {
    if (a.severity === "info") continue;
    for (const d of a.dests) out[d][a.severity] += 1;
  }
  return out;
}

export const payrollStatus = (counts: Record<PayrollDest, DestCounts>): Record<PayrollDest, DestStatus> =>
  Object.fromEntries(PAYROLL_DESTS.map((d) => [d, destStatus(counts[d])])) as Record<PayrollDest, DestStatus>;

export const sortPayrollAlerts = (alerts: PayrollAlert[]) => [...alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
