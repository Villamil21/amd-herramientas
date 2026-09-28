import { Alert } from "../../../../components/ui";
import type { ParsedStatement, StatementValidation } from "../types";

const MAX_ISSUES = 8;

export function ValidationPanel({ statement, validation }: { statement: ParsedStatement; validation: StatementValidation }) {
  const passed = validation.checks.filter((c) => c.status === "ok");
  const failed = validation.checks.filter((c) => c.status === "failed");
  const unavailable = validation.checks.filter((c) => c.status === "unavailable");

  if (validation.validated) {
    return (
      <Alert tone="success" title="Extracto validado">
        Se revisaron {statement.pageCount} {statement.pageCount === 1 ? "página" : "páginas"}. Los movimientos coinciden con el resumen del
        extracto y con la secuencia de saldos.
        {unavailable.length > 0 && <> No fue posible comprobar: {unavailable.map((c) => c.label).join("; ")}.</>}
      </Alert>
    );
  }

  const summaryMismatch = failed.some((c) => ["credits", "debits", "net", "last-balance", "balances"].includes(c.id));
  const items = [
    ...failed.filter((c) => c.id !== "issues").map((c) => `${c.label}: ${c.detail ?? "no coincide."}`),
    ...statement.issues.slice(0, MAX_ISSUES).map((i) => `Página ${i.page}: «${i.text}». ${i.reason}`),
  ];
  if (statement.issues.length > MAX_ISSUES) items.push(`… y ${statement.issues.length - MAX_ISSUES} fila(s) más sin interpretar.`);
  if (failed.length === 0) items.push(...unavailable.map((c) => `${c.label}: ${c.detail ?? "no disponible."}`));

  const title =
    statement.issues.length > 0
      ? "Se encontraron movimientos cuyo valor no pudo interpretarse."
      : summaryMismatch
        ? "Se detectó una inconsistencia entre los movimientos extraídos y el resumen del extracto."
        : failed.length > 0
          ? "El análisis no pudo validarse."
          : "No fue posible validar el análisis contra el resumen del extracto.";

  return (
    <Alert tone="warning" title={title} items={items}>
      Los datos no se modificaron. Revisa los grupos y sus movimientos antes de usar el resultado{passed.length > 0 && `; controles correctos: ${passed.map((c) => c.label).join("; ")}`}.
    </Alert>
  );
}
