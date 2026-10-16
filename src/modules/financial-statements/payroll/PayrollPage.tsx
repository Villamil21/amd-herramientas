import type { PdfDocumentText } from "../../bank-analysis/shared/pdf/pdfTypes";
import { analyzeAportesEnLinea } from "../../social-security/payroll-summary/aportes-en-linea/services/analysis";
import type { PayrollAnalysis } from "../../social-security/payroll-summary/shared/types";
import { planillaEntitiesFor } from "../../exogena/domain/planillaEntities";
import { slashToIso } from "../shared/money";
import { PayrollFlow } from "./PayrollFlow";
import type { PayrollOperator, PlanillaView } from "./operators";

interface Analysis extends PayrollAnalysis {
  /** NIT del aportante (DATOS GENERALES DEL APORTANTE), para identificar la empresa. */
  employerNit?: string;
}

function analyze(text: PdfDocumentText): Analysis {
  const nit = text.pages[0]?.items.map((i) => /^NIT\s+(\d{5,})/.exec(i.text.trim())).find(Boolean);
  return { ...analyzeAportesEnLinea(text), employerNit: nit?.[1] };
}

const view = ({ summary, employerNit }: Analysis): PlanillaView => {
  const paymentDate = slashToIso(summary.paymentDate) ?? null;
  const { entities, warning } = planillaEntitiesFor(summary.paymentSummary?.entities ?? [], summary.paymentSummary?.liquidatedByRisk ?? {}, summary.period, paymentDate);
  return {
    period: summary.period,
    paymentDate,
    employees: summary.employees,
    lateInterest: summary.lateInterest,
    issues: summary.issues,
    warnings: warning ? [warning] : [],
    employerNit,
    entities,
  };
};

/** Aportes en Línea: usa el lector existente de la planilla (sin modificar «Resumen de planilla»). */
const APORTES_EN_LINEA: PayrollOperator<Analysis> = {
  id: "aportes-en-linea",
  provider: "Aportes en Línea",
  title: "Aportes en Línea",
  description: "Importa la planilla de seguridad social para causar salarios, auxilio, aportes y prestaciones por empleado y enviarlos a Estados Financieros.",
  labels: { pick: "Seleccionar planilla PDF", pickAnother: "Seleccionar otra planilla", analyzing: "Analizando planilla…" },
  pickTitle: "Seleccionar planilla PDF",
  logTag: "fs-nomina",
  fallbackError: "No fue posible analizar la planilla. Verifica que sea una planilla de Aportes en Línea en PDF.",
  analyze,
  view,
  socialLabel: "Seguridad social",
  exportPrefix: "Nomina_EEFF",
  dedupeKey: (v) => `payroll:${v.period}`,
  moraDocumentId: (v) => `planilla|${v.period}`,
  issuesBlocking: "Hay filas de la planilla sin interpretar",
  issuesHint: "Revisa la planilla en Seguridad social → Resumen de planilla.",
};

export default function PayrollPage() {
  return <PayrollFlow operator={APORTES_EN_LINEA} />;
}
