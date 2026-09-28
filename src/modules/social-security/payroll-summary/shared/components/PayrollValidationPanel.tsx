import { Alert } from "../../../../../components/ui";
import type { PayrollSummary, PayrollValidation } from "../types";

const MAX_ISSUES = 8;

/**
 * Resultado de la validación. Nunca corrige valores: si algo no cuadra se
 * muestra la advertencia y los datos extraídos quedan tal cual para revisarlos.
 */
export function PayrollValidationPanel({ summary, validation }: { summary: PayrollSummary; validation: PayrollValidation }) {
  const failed = validation.checks.filter((c) => c.status === "failed");
  const unavailable = validation.checks.filter((c) => c.status === "unavailable");
  const pages = `${summary.pageCount} ${summary.pageCount === 1 ? "página" : "páginas"}`;

  if (validation.validated) {
    return (
      <Alert tone="success" title="Análisis validado">
        Se revisaron {pages}. La suma de los aportes por empleado coincide con Total Afiliados, y valor pagado − total aportes coincide con los intereses de mora
        del Resumen de pago.
        {unavailable.length > 0 && <> No fue posible comprobar: {unavailable.map((c) => c.label).join("; ")}.</>}
      </Alert>
    );
  }

  const items = [
    ...failed
      .filter((c) => c.id !== "issues")
      .map((c) => (c.id === "employee-sum" ? c.detail : `${c.label}: ${c.detail ?? "no coincide."}`)),
    ...summary.issues.slice(0, MAX_ISSUES).map((i) => `Página ${i.page}: «${i.text}». ${i.reason}`),
    ...unavailable.map((c) => `${c.label}: no fue posible comprobarlo; ${c.detail ?? "dato no disponible."}`),
  ];
  if (summary.issues.length > MAX_ISSUES) items.push(`… y ${summary.issues.length - MAX_ISSUES} fila(s) más sin interpretar.`);

  const title =
    summary.issues.length > 0
      ? "Hay filas de la planilla que no se pudieron interpretar."
      : failed.length > 0
        ? "Se detectó una inconsistencia entre los valores extraídos y los totales de la planilla."
        : "No fue posible validar completamente el análisis.";

  return (
    <Alert tone="warning" title={title} items={items}>
      Los valores no se modificaron. Revisa el resumen y el detalle por empleado antes de usar el resultado.
    </Alert>
  );
}
