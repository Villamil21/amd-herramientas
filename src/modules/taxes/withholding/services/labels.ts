import { RETENTION_TYPE_LABEL } from "../../../../types/models";
import type { DocRow, DocStatus, RuleLine } from "../types";
import { formatRateBp } from "./money";

export const STATUS_LABEL: Record<DocStatus, string> = {
  validated: "Validada",
  "ignored-regime": "Ignorada por régimen",
  "out-of-period": "Fuera del periodo",
  duplicate: "Duplicada",
  "below-minimum": "No supera tope",
  "pending-supplier": "Pendiente proveedor",
  "pending-base": "Pendiente base",
  "pending-title": "Pendiente clasificación de título",
  "pending-period": "Pendiente periodo",
  difference: "Diferencia de retención",
  review: "Requiere revisión",
  incompatible: "No compatible",
  error: "Error",
};

export const STATUS_TONE: Record<DocStatus, "success" | "gold" | "warning" | "danger" | "dark" | undefined> = {
  validated: "success",
  "ignored-regime": "dark",
  "out-of-period": "dark",
  duplicate: "dark",
  "below-minimum": undefined,
  "pending-supplier": "gold",
  "pending-base": "gold",
  "pending-title": "gold",
  "pending-period": "gold",
  difference: "danger",
  review: "warning",
  incompatible: "danger",
  error: "danger",
};

export const PENDING_STATUSES: DocStatus[] = ["pending-supplier", "pending-base", "pending-title", "pending-period", "difference", "review"];

/** Subcategoría de «Documentos ignorados». */
export function ignoredGroup(status: DocStatus): string | undefined {
  switch (status) {
    case "ignored-regime":
      return "Régimen/responsabilidad excluida";
    case "out-of-period":
      return "Fuera del periodo";
    case "duplicate":
      return "Duplicados";
    case "incompatible":
    case "error":
      return "No compatibles";
    default:
      return undefined;
  }
}

const distinct = (values: string[]) => [...new Set(values)].join(" / ");

/** Reglas que aplican en el documento (la única, o las marcadas como «Aplica»). */
export const appliedLines = (r: DocRow): RuleLine[] => r.lines.filter((l) => l.state === "applies");

/** Tipo(s) de retención del documento: «Servicios», o «Servicios / Compras» si aplican varias reglas. */
export const ruleTypeText = (r: DocRow) => distinct(appliedLines(r).map((l) => RETENTION_TYPE_LABEL[l.rule.retentionType])) || undefined;

export const ruleSubtypeText = (r: DocRow) => distinct(appliedLines(r).map((l) => l.rule.subtypeName)) || undefined;

/** Tarifa(s) del documento: «4 %», o «1 % / 4 %» si aplican varias reglas. */
export function rateText(r: DocRow): string | undefined {
  if (r.rateBp !== undefined) return formatRateBp(r.rateBp);
  return distinct(appliedLines(r).map((l) => formatRateBp(l.rateBp))) || undefined;
}

/** Reglas aplicadas cuya base no superó su tope, de documentos válidos: se conservan para auditoría. */
export function belowMinimumLines(rows: DocRow[]): { row: DocRow; line: RuleLine }[] {
  return rows.filter((r) => r.status === "below-minimum" || r.status === "validated").flatMap((row) => row.lines.filter((l) => l.belowMinimum).map((line) => ({ row, line })));
}
