import { planillaEntitiesFor, type RawPlanillaEntity } from "../../../exogena/domain/planillaEntities";
import type { PayrollOperator, PlanillaView } from "../operators";
import { moraDocumentIdV2, dedupeKeyV2 } from "./store";
import { normalizePlanilla } from "./normalize";
import type { NormalizedPlanilla } from "./types";

const LEGACY_TYPES = ["AFP", "EPS", "ARL", "CCF"] as const;
const KEY_OF = { AFP: "pension", EPS: "health", ARL: "arl", CCF: "ccf" } as const;

/** Vista que usa el flujo de Nómina a partir de la planilla normalizada (el operador ya no importa). */
export function planillaView(p: NormalizedPlanilla): PlanillaView {
  const raw: RawPlanillaEntity[] = p.entities.flatMap((e) => (e.kind === "SENA" || e.kind === "ICBF" ? [] : [{ type: e.kind, name: e.name, code: e.code, nit: e.nit, dv: e.dv, liquidated: e.liquidated }]));
  // El total esperado por tipo es la suma del detalle por empleado: la propia planilla ya se validó contra sus totales.
  const expected = Object.fromEntries(LEGACY_TYPES.map((t) => [t, p.employees.reduce((n, e) => n + e.contributions[KEY_OF[t]], 0)]));
  const { entities, warning } = planillaEntitiesFor(raw, expected, p.period, p.paymentDate);
  return {
    provider: p.operatorLabel,
    planilla: p,
    period: p.period,
    paymentDate: p.paymentDate,
    employees: p.employees.map((e) => ({
      identification: `${e.docType} ${e.docNumber}`,
      name: e.name,
      pensionDays: e.pension.days ?? 0,
      pensionIbc: e.pension.ibc ?? 0,
      pensionContribution: e.contributions.pension,
      healthContribution: e.contributions.health,
      riskContribution: e.contributions.arl,
      ccfContribution: e.contributions.ccf,
      sena: e.contributions.sena,
      icbf: e.contributions.icbf,
      otherContribution: Object.values(e.unrecognized).reduce((n, v) => n + v, 0),
      parafiscales: e.unrecognized,
    })),
    lateInterest: p.lateInterest,
    issues: p.issues,
    warnings: [...p.warnings, ...(warning ? [warning] : [])],
    employerNit: p.employer.nit,
    planillaId: p.planillaNumber,
    entities,
  };
}

/** Único operador de la interfaz: detecta Aportes en Línea o MiPlanilla (y SOI cuando exista) a partir del PDF. */
export const PLANILLA_IMPORT: PayrollOperator<NormalizedPlanilla> = {
  id: "planilla",
  title: "Nómina y seguridad social",
  description: "Importa la planilla PDF: se detecta el operador, se causa la nómina en Estados Financieros y se alimentan los formatos 1001, 1011 y 2276 de Información Exógena.",
  labels: { pick: "Importar planilla PDF", pickAnother: "Importar otra planilla", analyzing: "Analizando planilla…" },
  pickTitle: "Importar planilla PDF",
  logTag: "fs-nomina",
  fallbackError: "No fue posible analizar la planilla. Verifica que sea una planilla de Aportes en Línea o de MiPlanilla en PDF.",
  keepRotatedText: true,
  analyze: normalizePlanilla,
  view: planillaView,
  socialLabel: "Seguridad social",
  cotizacionColumn: false,
  exportPrefix: "Nomina_SS",
  dedupeKey: (v) => (v.planilla ? dedupeKeyV2(v.planilla) : `payroll:${v.period}`),
  moraDocumentId: (v) => (v.planilla ? moraDocumentIdV2(v.planilla) : `planilla|${v.period}`),
  issuesBlocking: "Hay filas sin interpretar o totales de la planilla que no cuadran",
  issuesHint: "Revisa el PDF original de la planilla.",
};
