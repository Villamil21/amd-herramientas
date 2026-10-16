import { FileCheck2 } from "lucide-react";
import type { CompanyInput } from "../../types/models";
import { SOURCE_LABEL, type ImportField } from "./import/importPlan";
import type { CompanyImport } from "./import/useCompanyImport";

/**
 * Marca discreta de un dato precargado desde el RUT o la Cámara. Se muestra mientras el campo conserve el valor importado;
 * si el usuario lo edita deja de mostrarse. El detalle va en el tooltip (sin etiquetas «Desde RUT» por campo).
 */
export function originMark(field: ImportField, values: CompanyInput, imports: Pick<CompanyImport, "origins">) {
  const origin = imports.origins[field];
  if (!origin || String(values[field]) !== String(origin.value)) return undefined;
  const text = `Precargado desde ${origin.sources.map((s) => SOURCE_LABEL[s]).join(" y ")}`;
  return (
    <span className="origin-mark" title={text} role="img" aria-label={text}>
      <FileCheck2 size={13} />
    </span>
  );
}
