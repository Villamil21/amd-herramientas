import type { PdfDocumentText } from "../../../bank-analysis/shared/pdf/pdfTypes";
import { parseMiPlanilla } from "./parser";
import { cotizacionOf, PARAFISCAL_LABEL, PARAFISCALS, SUBSYSTEM_LABEL, type MiPlanillaCheck, type MiPlanillaIssue, type MiPlanillaSummary, type Subsystem } from "./types";

const SUBSYSTEMS: Subsystem[] = ["pension", "health", "risk", "ccf"];
const pesos = (n: number) => `$${new Intl.NumberFormat("es-CO").format(n)}`;
const EMPLOYEE_VALUE: Record<Subsystem, (s: MiPlanillaSummary) => number> = {
  pension: (s) => s.employees.reduce((n, e) => n + e.pensionContribution, 0),
  health: (s) => s.employees.reduce((n, e) => n + e.healthContribution, 0),
  risk: (s) => s.employees.reduce((n, e) => n + e.riskContribution, 0),
  ccf: (s) => s.employees.reduce((n, e) => n + e.ccfContribution, 0),
};

export interface MiPlanillaAnalysis {
  summary: MiPlanillaSummary;
  checks: MiPlanillaCheck[];
  /** Intereses de mora de la planilla (global): total a pagar − valor antes de mora. */
  lateInterest: number;
  /** true solo si ningún control falló y no hay filas sin interpretar. */
  validated: boolean;
  /** Lo que no se pudo verificar (informativo: no bloquea, pero se muestra). */
  warnings: string[];
}

function compare(id: string, label: string, detail: number | undefined, summary: number | undefined, what: string): MiPlanillaCheck {
  if (detail === undefined || summary === undefined) return { id, label, status: "unavailable", detail: `No se encontró ${what} en la planilla: no se puede verificar.` };
  return detail === summary ? { id, label, status: "ok" } : { id, label, status: "failed", detail: `El detalle suma ${pesos(detail)} y ${what} indica ${pesos(summary)} (diferencia ${pesos(Math.abs(detail - summary))}).` };
}

/** Controles de MiPlanilla: el detalle por cotizante contra los totales por subsistema y el encabezado. */
export function validateMiPlanilla(s: MiPlanillaSummary): { checks: MiPlanillaCheck[]; lateInterest: number } {
  const checks: MiPlanillaCheck[] = [];
  const interpreted = s.employees.length;
  checks.push(
    s.detectedRows === interpreted
      ? { id: "rows", label: "Todas las filas del detalle se interpretaron", status: "ok" }
      : { id: "rows", label: "Todas las filas del detalle se interpretaron", status: "failed", detail: `Se detectaron ${s.detectedRows} filas y se interpretaron ${interpreted}.` },
  );
  checks.push(
    s.declaredEmployees === undefined
      ? { id: "count", label: "Cantidad de empleados del encabezado", status: "unavailable", detail: "No se encontró la cantidad de empleados del encabezado." }
      : s.declaredEmployees === interpreted
        ? { id: "count", label: "Cantidad de empleados del encabezado", status: "ok" }
        : { id: "count", label: "Cantidad de empleados del encabezado", status: "failed", detail: `El encabezado declara ${s.declaredEmployees} empleados y el detalle trae ${interpreted}.` },
  );
  for (const sub of SUBSYSTEMS) {
    const label = `${SUBSYSTEM_LABEL[sub]}: detalle = total del subsistema`;
    checks.push(compare(`detail-${sub}`, label, EMPLOYEE_VALUE[sub](s), s.totals.subsystems[sub]?.contribution, "«Totales por subsistema»"));
    const admin = s.administrators[sub];
    checks.push(compare(`admin-${sub}`, `${SUBSYSTEM_LABEL[sub]}: administradoras = total del subsistema`, admin?.contribution, s.totals.subsystems[sub]?.contribution, "«Totales por subsistema»"));
  }
  for (const p of PARAFISCALS) {
    const detail = s.employees.reduce((n, e) => n + e.parafiscales[p], 0);
    checks.push(compare(`para-${p}`, `${PARAFISCAL_LABEL[p]}: detalle = total`, detail, s.totals.parafiscales[p]?.contribution, "«Totales por subsistema»"));
  }
  const grand = s.totals.grand;
  const before = SUBSYSTEMS.reduce((n, sub) => n + (s.totals.subsystems[sub]?.contribution ?? 0), 0) + PARAFISCALS.reduce((n, p) => n + (s.totals.parafiscales[p]?.contribution ?? 0), 0);
  checks.push(compare("grand-before", "Suma de subsistemas = total antes de mora", grand ? before : undefined, grand?.contribution, "el total general"));
  const toPay = SUBSYSTEMS.reduce((n, sub) => n + (s.totals.subsystems[sub]?.toPay ?? 0), 0) + PARAFISCALS.reduce((n, p) => n + (s.totals.parafiscales[p]?.toPay ?? 0), 0);
  checks.push(compare("grand-pay", "Total a pagar de los subsistemas = total a pagar del encabezado", grand ? toPay : undefined, s.totalToPay, "el valor total a pagar del encabezado"));

  // Mora global: lo pagado menos lo liquidado antes de mora. No se reparte entre empleados.
  const beforeMora = grand?.contribution ?? (s.employees.reduce((n, e) => n + cotizacionOf(e) + Object.values(e.parafiscales).reduce((a, b) => a + b, 0), 0));
  const lateInterest = s.totalToPay === undefined ? 0 : s.totalToPay - beforeMora;
  checks.push(
    s.totalToPay === undefined
      ? { id: "mora", label: "Intereses de mora", status: "unavailable", detail: "No se encontró el valor total a pagar: no se puede calcular la mora." }
      : lateInterest >= 0
        ? { id: "mora", label: "Intereses de mora", status: "ok", detail: lateInterest ? `Mora de la planilla: ${pesos(lateInterest)}.` : undefined }
        : { id: "mora", label: "Intereses de mora", status: "failed", detail: `El total a pagar (${pesos(s.totalToPay)}) es menor que lo liquidado (${pesos(beforeMora)}).` },
  );
  // Informativo: el total de nómina del encabezado suele coincidir con la suma de los IBC de pensión.
  const ibc = s.employees.reduce((n, e) => n + e.pensionIbc, 0);
  checks.push(
    s.totalPayroll === undefined
      ? { id: "payroll", label: "Total nómina del encabezado", status: "unavailable", detail: "No se encontró el total de nómina del encabezado." }
      : s.totalPayroll === ibc
        ? { id: "payroll", label: "Total nómina del encabezado", status: "ok" }
        : { id: "payroll", label: "Total nómina del encabezado", status: "unavailable", detail: `El total de nómina (${pesos(s.totalPayroll)}) no coincide con la suma de los IBC de pensión (${pesos(ibc)}); es informativo y no se usa.` },
  );
  return { checks, lateInterest: Math.max(0, lateInterest) };
}

/** Lee la planilla, la valida y deja listo lo que usa el flujo de Nómina. Nunca inventa valores. */
export function analyzeMiPlanilla(doc: PdfDocumentText): MiPlanillaAnalysis {
  const summary = parseMiPlanilla(doc);
  const { checks, lateInterest } = validateMiPlanilla(summary);
  const issues: MiPlanillaIssue[] = [...summary.issues];
  for (const c of checks) if (c.status === "failed") issues.push({ page: 0, text: c.label, reason: c.detail ?? "El control no cuadra." });
  for (const e of summary.employees) {
    if (e.pensionExtras > 0) {
      issues.push({ page: e.page, text: `Fila ${e.rowNumber} · ${e.name}`, reason: `Tiene aportes voluntarios o al FSP de pensión (${pesos(e.pensionExtras)}) que no tienen tratamiento contable definido.` });
    }
  }
  const warnings = checks.filter((c) => c.status === "unavailable" && c.detail).map((c) => c.detail!);
  const final: MiPlanillaSummary = { ...summary, issues };
  return { summary: final, checks, lateInterest, validated: issues.length === 0, warnings };
}
