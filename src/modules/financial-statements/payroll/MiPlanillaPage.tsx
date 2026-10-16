import { PayrollFlow } from "./PayrollFlow";
import { analyzeMiPlanilla, type MiPlanillaAnalysis } from "./miplanilla/analysis";
import { PARAFISCALS } from "./miplanilla/types";
import type { PayrollOperator, PlanillaView } from "./operators";

/** La mora es global: no se reparte entre empleados. «Cotización» = pensión + salud + riesgos + CCF. */
const view = ({ summary, lateInterest, warnings }: MiPlanillaAnalysis): PlanillaView => ({
  period: summary.pensionPeriod,
  paymentDate: summary.paymentDate ?? null,
  employees: summary.employees.map((e) => ({
    identification: e.identification,
    name: e.name,
    pensionDays: e.pensionDays,
    pensionIbc: e.pensionIbc,
    pensionContribution: e.pensionContribution,
    healthContribution: e.healthContribution,
    riskContribution: e.riskContribution,
    ccfContribution: e.ccfContribution,
    otherContribution: PARAFISCALS.reduce((n, p) => n + e.parafiscales[p], 0),
    parafiscales: e.parafiscales,
  })),
  lateInterest,
  issues: summary.issues,
  warnings,
  employerNit: summary.employerNit,
  planillaId: summary.planillaNumber,
});

/** MiPlanilla: lector propio del PDF; el resto del flujo es el mismo de Aportes en Línea. */
const MI_PLANILLA: PayrollOperator<MiPlanillaAnalysis> = {
  id: "mi-planilla",
  provider: "MiPlanilla",
  title: "MiPlanilla",
  description: "Importa la planilla de MiPlanilla para causar salarios, auxilio, cotizaciones y prestaciones por empleado y enviarlos a Estados Financieros. El período es el de pensión.",
  labels: { pick: "Seleccionar planilla PDF", pickAnother: "Seleccionar otra planilla", analyzing: "Analizando planilla de MiPlanilla…" },
  pickTitle: "Seleccionar planilla de MiPlanilla (PDF)",
  logTag: "fs-nomina-miplanilla",
  fallbackError: "No fue posible analizar la planilla. Verifica que sea una Planilla Integrada de Autoliquidación de MiPlanilla en PDF.",
  keepRotatedText: true,
  analyze: analyzeMiPlanilla,
  view,
  socialLabel: "Cotización",
  cotizacionColumn: true,
  exportPrefix: "Nomina_EEFF_MiPlanilla",
  // Una planilla distinta del mismo periodo convive; la misma planilla reemplaza a su envío anterior.
  dedupeKey: (v) => `payroll:${v.period}:mi-planilla:${v.planillaId ?? "sin-numero"}`,
  moraDocumentId: (v) => `planilla|${v.period}|mi-planilla|${v.planillaId ?? "sin-numero"}`,
  issuesBlocking: "Hay filas sin interpretar o totales de la planilla que no cuadran",
};

export default function MiPlanillaPage() {
  return <PayrollFlow operator={MI_PLANILLA} />;
}
