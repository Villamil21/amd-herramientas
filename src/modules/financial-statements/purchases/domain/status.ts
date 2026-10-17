/**
 * Vocabulario de estado unificado de Compras, Estados Financieros y Exógena.
 *
 *  - Rojo «Bloquea»: impide generar, marcar listo o exportar el destino afectado.
 *  - Azul «Pendiente de confirmar»: propuesta de PUC, concepto o dato extraído. Hasta confirmarla el destino tampoco puede
 *    quedar listo (no hay dato definitivo), pero basta confirmarla: no es un error.
 *  - Ámbar «Requiere revisión»: discrepancia o decisión relevante pendiente; no impide generar.
 *  - Verde «Listo»: sin pendientes.
 *  - Gris «No aplica»: con justificación.
 *
 * El color nunca va solo: cada estado lleva icono, texto, cantidad y destino.
 */

export type Dest = "EEFF" | "1001" | "1005" | "1006";

export const DESTS: Dest[] = ["EEFF", "1001", "1005", "1006"];

export const DEST_LABEL: Record<Dest, string> = {
  EEFF: "Estados Financieros",
  "1001": "Formato 1001",
  "1005": "Formato 1005",
  "1006": "Formato 1006",
};

/** Severidad de una alerta concreta. `info` solo informa (no cuenta en ningún destino). */
export type Severity = "block" | "pending" | "review" | "info";

/** Estado de un destino (la severidad más alta que lo afecta, o listo / no aplica). */
export type DestStatus = "block" | "pending" | "review" | "ready" | "na";

export const STATUS_LABEL: Record<DestStatus, string> = {
  block: "Bloquea",
  pending: "Pendiente de confirmar",
  review: "Requiere revisión",
  ready: "Listo",
  na: "No aplica",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  block: "Bloquea",
  pending: "Pendiente de confirmar",
  review: "Requiere revisión",
  info: "Informativo",
};

/** Insignia del sistema de diseño que corresponde a cada estado. */
export const STATUS_TONE: Record<DestStatus, "danger" | "info" | "warning" | "success" | "neutral"> = {
  block: "danger",
  pending: "info",
  review: "warning",
  ready: "success",
  na: "neutral",
};

/** Orden de gravedad (menor = más grave) para ordenar alertas y elegir el estado de un destino. */
export const SEVERITY_ORDER: Record<Severity, number> = { block: 0, pending: 1, review: 2, info: 3 };

/** A dónde lleva «Resolver» en una alerta: abre directamente el dato a corregir. */
export type AlertTarget =
  | { kind: "document"; docId: number }
  | { kind: "line"; docId: number; lineIndex: number }
  | { kind: "supplier"; nit: string; name?: string }
  | { kind: "company"; nit: string }
  | { kind: "concept"; year: number }
  | { kind: "title"; titleKey: string; title: string }
  | { kind: "upload"; uploadId: number }
  | { kind: "none" };

export interface Alert {
  /** Estable entre cálculos (clave React y deduplicación). */
  id: string;
  /** Tipo de alerta (agrupa las repetidas: «12 líneas por confirmar»). */
  code: string;
  severity: Severity;
  /** Destinos que afecta; vacío = informativa. */
  dests: Dest[];
  title: string;
  /** Qué bloquea y por qué. */
  why: string;
  /** Cómo corregirlo. */
  how: string;
  target: AlertTarget;
  /** Etiqueta del botón que abre el dato (por defecto «Resolver»). */
  action?: string;
}

/** Cantidad de alertas por severidad que afectan a un destino. */
export interface DestCounts {
  block: number;
  pending: number;
  review: number;
}

export const emptyCounts = (): DestCounts => ({ block: 0, pending: 0, review: 0 });

export function countByDest(alerts: readonly Alert[]): Record<Dest, DestCounts> {
  const out = Object.fromEntries(DESTS.map((d) => [d, emptyCounts()])) as Record<Dest, DestCounts>;
  for (const a of alerts) {
    if (a.severity === "info") continue;
    for (const d of a.dests) out[d][a.severity] += 1;
  }
  return out;
}

/** Estado de un destino: rojo > azul > ámbar > verde. «No aplica» manda sobre todo (con su justificación aparte). */
export function destStatus(counts: DestCounts, notApplicable = false): DestStatus {
  if (notApplicable) return "na";
  if (counts.block > 0) return "block";
  if (counts.pending > 0) return "pending";
  if (counts.review > 0) return "review";
  return "ready";
}

/** El destino no puede generarse, marcarse listo ni exportarse (rojo o azul: ambos dejan datos sin definir). */
export const stopsDest = (status: DestStatus) => status === "block" || status === "pending";

export const sortAlerts = (alerts: Alert[]) => [...alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
