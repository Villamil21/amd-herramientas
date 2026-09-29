import type { ConfigurableCategory, FixedStatus, StatusCategory, StatusRules } from "../types";

/**
 * Estado normalizado para comparar: sin tildes, en mayúsculas, "_" como
 * espacio y espacios colapsados. «Guía anulada», «GUIA_ANULADA» y
 * «GUÍA  ANULADA» dan la misma clave. El texto original se conserva aparte.
 */
export function statusKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FIXED: Record<string, FixedStatus> = {
  ENTREGADO: "delivered",
  CANCELADO: "cancelled",
  RECHAZADO: "rejected",
  "GUIA ANULADA": "void",
  DEVOLUCION: "returned",
  INDEMNIZADA: "indemnity",
};

/** «EN PROCESO DE INDEMNIZACION» y «EN PROCESO INDEMNIZACION». */
const IN_INDEMNITY = /^EN PROCESO (DE )?INDEMNIZACION$/;

/** Regla fija del estado (clave ya normalizada), si la tiene. */
export function fixedStatus(key: string): FixedStatus | undefined {
  return FIXED[key] ?? (IN_INDEMNITY.test(key) ? "indemnity" : undefined);
}

const FIXED_CATEGORY: Record<FixedStatus, StatusCategory> = {
  delivered: "delivered",
  cancelled: "cancelled_group",
  rejected: "cancelled_group",
  void: "cancelled_group",
  returned: "returned",
  indemnity: "indemnity",
};

/**
 * Clasificación de un estado. Las reglas fijas se evalúan primero: una regla
 * guardada nunca cambia la semántica de ENTREGADO, CANCELADO, etc.
 */
export function classifyStatus(key: string, rules: StatusRules): StatusCategory {
  const fixed = fixedStatus(key);
  if (fixed) return FIXED_CATEGORY[fixed];
  if (!key) return "unclassified";
  return rules.get(key) ?? "unclassified";
}

/** Estados con regla fija, para mostrarlos en la configuración. */
export const FIXED_RULES: { statuses: string; category: StatusCategory }[] = [
  { statuses: "ENTREGADO", category: "delivered" },
  { statuses: "CANCELADO · RECHAZADO · GUIA_ANULADA", category: "cancelled_group" },
  { statuses: "DEVOLUCION", category: "returned" },
  { statuses: "INDEMNIZADA · EN PROCESO DE INDEMNIZACION", category: "indemnity" },
];

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  delivered: "Entregado",
  cancelled_group: "Cancelada/Rechazada/Guía anulada",
  returned: "Devolución",
  in_process: "En proceso",
  claim: "Siniestro",
  indemnity: "Indemnización",
  unclassified: "Sin clasificar",
};

export const CONFIGURABLE_LABEL: Record<ConfigurableCategory, string> = { in_process: "En proceso", claim: "Siniestro", indemnity: "Indemnización" };

export const CONFIGURABLE_CATEGORIES = Object.keys(CONFIGURABLE_LABEL) as ConfigurableCategory[];
