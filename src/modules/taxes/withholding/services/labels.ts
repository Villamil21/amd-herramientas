import type { DocStatus } from "../types";

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
