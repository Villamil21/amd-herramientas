import type { PdfDocumentText } from "../../../../bank-analysis/shared/pdf/pdfTypes";
import { analyzeAportesEnLinea } from "../../../../social-security/payroll-summary/aportes-en-linea/services/analysis";
import type { PayrollEmployee, PaymentEntity } from "../../../../social-security/payroll-summary/shared/types";
import { slashToIso } from "../../../shared/money";
import { parseIdentification } from "../../calc";
import { OPERATOR_LABEL, PLANILLA_SCHEMA_VERSION, type NormalizedEmployee, type NormalizedEntity, type NormalizedPlanilla } from "../types";

const KIND: Record<string, NormalizedEntity["kind"] | undefined> = { AFP: "AFP", EPS: "EPS", ARL: "ARL", CCF: "CCF" };

function entityOf(e: PaymentEntity): NormalizedEntity | undefined {
  const kind = KIND[e.type];
  if (!kind) return undefined;
  return { kind, code: e.code, name: e.name, nit: e.nit, dv: e.dv, liquidated: e.liquidated, lateInterest: e.lateInterest, fsp: e.type === "AFP" ? (e.fspSolidarity ?? 0) + (e.fspSubsistence ?? 0) : undefined };
}

/** Aportes en Línea → modelo único. Los encabezados girados se descartan: este lector no los usa. */
export function normalizeAportesEnLinea(doc: PdfDocumentText): NormalizedPlanilla {
  const flat: PdfDocumentText = { ...doc, pages: doc.pages.map((p) => ({ ...p, items: p.items.filter((i) => !i.rotated) })) };
  const { summary: s, validation } = analyzeAportesEnLinea(flat);
  const nit = flat.pages[0]?.items.map((i) => /^NIT\s+(\d{5,})/.exec(i.text.trim())).find(Boolean)?.[1];
  const toNormalized = (e: PayrollEmployee): Omit<NormalizedEmployee, "segments"> => {
    const { docType, docNumber } = parseIdentification(e.identification);
    return {
      docType,
      docNumber,
      name: e.name,
      pension: { days: e.pensionDays, ibc: e.pensionIbc },
      health: e.health ?? {},
      risk: e.risk ?? {},
      ccf: e.ccf ?? {},
      contributions: { pension: e.pensionContribution, health: e.healthContribution, arl: e.riskContribution, ccf: e.ccfContribution, sena: 0, icbf: 0 },
      // Aportes en Línea trae SENA e ICBF en UNA columna: no se puede separar, queda pendiente con ese nombre exacto.
      unrecognized: e.otherContribution ? { "SENA e ICBF (sin separar)": e.otherContribution } : ({} as Record<string, number>),
      entityCodes: e.entityCodes ?? {},
      novelties: e.novelties ?? [],
      unreadCodes: e.unreadCodes ?? [],
      page: e.page,
      row: e.rowNumber,
    };
  };
  const employees: NormalizedEmployee[] = s.employees.map((e) => (e.segments ? { ...toNormalized(e), segments: e.segments.map(toNormalized) } : toNormalized(e)));
  const issues = [...s.issues];
  for (const c of validation.checks) if (c.status === "failed") issues.push({ page: 0, text: c.label, reason: c.detail ?? "El control no cuadra." });
  return {
    schemaVersion: PLANILLA_SCHEMA_VERSION,
    operator: "aportes-en-linea",
    operatorLabel: OPERATOR_LABEL["aportes-en-linea"],
    planillaNumber: s.planillaNumber,
    planillaType: s.planillaType,
    employer: { nit: s.employer?.nit ?? nit ?? "", dv: s.employer?.dv, name: s.employer?.name },
    period: s.period,
    healthPeriod: s.healthPeriod,
    paymentDate: slashToIso(s.paymentDate) ?? null,
    employees,
    entities: (s.paymentSummary?.entities ?? []).flatMap((e) => entityOf(e) ?? []),
    lateInterest: s.lateInterest,
    issues,
    checks: validation.checks,
    warnings: [],
    pageCount: s.pageCount,
  };
}
