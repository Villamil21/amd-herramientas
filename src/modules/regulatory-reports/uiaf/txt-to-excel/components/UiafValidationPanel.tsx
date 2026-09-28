import { Alert } from "../../../../../components/ui";
import type { UiafValidation } from "../types";

export const UIAF_STATUS = {
  ok: "Archivo analizado correctamente",
  issues: "El archivo contiene inconsistencias. Revisa las advertencias antes de exportar.",
} as const;

export function UiafValidationPanel({ validation }: { validation: UiafValidation }) {
  if (validation.valid) {
    return (
      <Alert tone="success" title={UIAF_STATUS.ok}>
        Encabezado y cierre de control reconocidos, todos los registros tienen 26 campos, las cantidades declaradas coinciden y la numeración es consecutiva.
      </Alert>
    );
  }
  const items = validation.checks.filter((c) => c.status !== "ok").flatMap((c) => c.details ?? [c.label]);
  return (
    <Alert tone="warning" title={UIAF_STATUS.issues} items={items}>
      Los datos no se modificaron. Puedes exportar el Excel, pero revisa estas advertencias primero.
    </Alert>
  );
}
