import { saveExcelSheets, type ExportSheet } from "../../../../bank-analysis/shared/excelExportService";
import type { PayrollSummary } from "../types";

const PROVIDER_NAME: Record<PayrollSummary["provider"], string> = { "aportes-en-linea": "AportesEnLinea" };

/**
 * Hoja 1 «Resumen»: Periodo, Fecha, Pago, Total Aportes, Intereses de Mora y
 * Cantidad de Empleados. Hoja 2 «Empleados»: una fila por empleado, en el
 * orden de la planilla.
 */
export function buildPayrollSheets(s: PayrollSummary): ExportSheet[] {
  const summary: ExportSheet = {
    name: "Resumen",
    columns: [
      { header: "Periodo", kind: "text" },
      { header: "Fecha", kind: "text" },
      { header: "Pago", kind: "pesos" },
      { header: "Total Aportes", kind: "pesos" },
      { header: "Intereses de Mora", kind: "pesos" },
      { header: "Cantidad de Empleados", kind: "integer" },
    ],
    rows: [[s.period, s.paymentDate, s.paymentAmount, s.totalContributions, s.lateInterest, s.employeeCount]],
  };

  const employees: ExportSheet = {
    name: "Empleados",
    columns: [
      { header: "Empleado", kind: "text" },
      { header: "Nombre", kind: "text" },
      { header: "Pensión Días", kind: "integer" },
      { header: "Pensión IBC", kind: "pesos" },
      { header: "Pensión Aporte", kind: "pesos" },
      { header: "Salud Aporte", kind: "pesos" },
      { header: "CCF Aporte", kind: "pesos" },
      { header: "Riesgos Aporte", kind: "pesos" },
      { header: "Total Aportes", kind: "pesos" },
    ],
    rows: s.employees.map((e) => [
      e.identification,
      e.name,
      e.pensionDays,
      e.pensionIbc,
      e.pensionContribution,
      e.healthContribution,
      e.ccfContribution,
      e.riskContribution,
      e.totalContribution,
    ]),
  };

  return [summary, employees];
}

/** Nombre sugerido: Resumen_Planilla_AportesEnLinea_2026-01. */
export function suggestedPayrollExportName(s: PayrollSummary): string {
  return `Resumen_Planilla_${PROVIDER_NAME[s.provider]}_${s.period}`;
}

/** Diálogo nativo para guardar. Devuelve la ruta o null si se cancela. */
export function exportPayrollExcel(s: PayrollSummary) {
  return saveExcelSheets(buildPayrollSheets(s), suggestedPayrollExportName(s));
}
