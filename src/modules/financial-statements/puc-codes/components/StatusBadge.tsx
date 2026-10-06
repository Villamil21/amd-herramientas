import { Badge } from "../../../../components/ui";
import { CLASSIFICATION_LABEL, type DocRow } from "../types";

const TONE = { pending: "danger", partial: "warning", classified: "success" } as const;

/** Estado de clasificación del documento (o por qué no participa). */
export function ClassificationBadge({ row }: { row: Pick<DocRow, "classification" | "excluded" | "failure"> }) {
  if (row.excluded) return <Badge tone="dark">Excluido</Badge>;
  if (row.failure) return <Badge tone="danger">{row.failure.kind === "incompatible" ? "No compatible" : "Error"}</Badge>;
  return <Badge tone={TONE[row.classification]}>{CLASSIFICATION_LABEL[row.classification]}</Badge>;
}
