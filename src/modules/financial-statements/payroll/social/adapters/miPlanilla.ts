import type { PdfDocumentText } from "../../../../bank-analysis/shared/pdf/pdfTypes";
import { analyzeMiPlanilla } from "../../miplanilla/analysis";
import type { Subsystem } from "../../miplanilla/types";
import { parseIdentification } from "../../calc";
import { OPERATOR_LABEL, PLANILLA_SCHEMA_VERSION, type EntityKind, type NormalizedEmployee, type NormalizedEntity, type NormalizedPlanilla } from "../types";

const ENTITY_OF: Record<Subsystem, EntityKind> = { pension: "AFP", health: "EPS", risk: "ARL", ccf: "CCF" };

/** MiPlanilla → modelo único. SENA e ICBF vienen separados; ESAP y MEN quedan pendientes con su nombre. */
export function normalizeMiPlanilla(doc: PdfDocumentText): NormalizedPlanilla {
  const { summary: s, checks, lateInterest, warnings } = analyzeMiPlanilla(doc);
  const employees: NormalizedEmployee[] = s.employees.map((e) => {
    const { docType, docNumber } = parseIdentification(e.identification);
    const unrecognized: Record<string, number> = {};
    if (e.parafiscales.esap) unrecognized.ESAP = e.parafiscales.esap;
    if (e.parafiscales.men) unrecognized.MEN = e.parafiscales.men;
    return {
      docType,
      docNumber,
      name: e.name,
      pension: { days: e.pensionDays, ibc: e.pensionIbc },
      health: { days: e.healthDays, ibc: e.healthIbc },
      risk: { days: e.riskDays, ibc: e.riskIbc },
      ccf: { days: e.ccfDays, ibc: e.ccfIbc },
      contributions: { pension: e.pensionContribution, health: e.healthContribution, arl: e.riskContribution, ccf: e.ccfContribution, sena: e.parafiscales.sena, icbf: e.parafiscales.icbf },
      unrecognized,
      pensionExtras: { solidarity: e.fspSolidarity, subsistence: e.fspSubsistence, voluntary: e.voluntaryPension },
      entityCodes: e.entityCodes ?? {},
      novelties: e.novelties ?? [],
      unreadCodes: [],
      page: e.page,
      row: e.rowNumber,
    };
  });
  const entities: NormalizedEntity[] = [];
  for (const [sub, kind] of Object.entries(ENTITY_OF) as [Subsystem, EntityKind][]) {
    for (const a of s.administrators[sub]?.entities ?? []) entities.push({ kind, code: a.code, name: a.name, nit: a.nit, dv: a.dv, liquidated: a.contribution });
  }
  return {
    schemaVersion: PLANILLA_SCHEMA_VERSION,
    operator: "miplanilla",
    operatorLabel: OPERATOR_LABEL.miplanilla,
    planillaNumber: s.planillaNumber,
    planillaType: s.planillaType,
    employer: { nit: s.employerNit ?? "", dv: s.employerDv, name: s.employerName },
    period: s.pensionPeriod,
    healthPeriod: s.healthPeriod,
    paymentDate: s.paymentDate ?? null,
    employees,
    entities,
    lateInterest,
    issues: s.issues,
    checks,
    warnings,
    pageCount: s.pageCount,
  };
}
