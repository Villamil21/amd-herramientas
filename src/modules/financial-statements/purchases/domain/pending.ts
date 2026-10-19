import type { PurchasesModel } from "./model";
import { DEST_LABEL, SEVERITY_LABEL, type Alert, type Dest, type DestCounts, type DestStatus, type Severity } from "./status";

/**
 * Panel de pendientes por destino (Estados Financieros, 1001, 1005 o 1006). Función pura sobre el modelo: filtra las alertas que
 * afectan SOLO al destino elegido, las agrupa por causa (una alerta idéntica por factura se vuelve una sola fila) y calcula el
 * avance. No decide nada por el usuario: cada grupo solo apunta al dato que él debe confirmar o corregir.
 */

/** Alertas cuya unidad es una línea (el resto afecta a la factura completa, al proveedor o a la empresa). */
const LINE_CODES = new Set(["line-unconfirmed", "puc-invalid", "concept-invalid"]);

const PLURAL = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Causa legible de cada tipo de alerta. Lo que no figure aquí usa el título de su primera alerta. */
const CAUSE: Record<string, string> = {
  "line-unconfirmed:proposal": "Líneas con PUC y concepto propuestos, por confirmar",
  "line-unconfirmed:no-proposal": "Líneas sin PUC o concepto",
  "puc-invalid": "Líneas con PUC no válido",
  "concept-invalid": "Líneas con concepto 1001 no válido",
  "title-unknown": "Tipo de comprobante sin clasificar",
  "name-mismatch": "Facturas con nombre de comprador por confirmar",
  "third-incomplete": "Datos faltantes del tercero",
  "vat-year-unknown": "Perfil de IVA de la empresa faltante",
  "retention-mismatch": "Retención con diferencia frente al cálculo",
  "retention-exempt": "Retención de proveedor exento sin decisión",
  "lines-unread": "Error de lectura de una línea",
  "no-lines": "Facturas sin productos",
  "no-date": "Facturas sin fecha de expedición",
  "no-buyer": "Facturas sin NIT del adquiriente",
  "unknown-company": "Empresa compradora no registrada",
  "uvt-missing": "Falta el UVT del año de la factura",
  "retention-concept-missing": "Concepto de retención que ya no existe",
  "iva-reconciliation": "IVA de 1005, 1006 y 1001 no concilia",
};

/** Efecto concreto de la causa sobre un destino; lo que no figure usa el texto genérico de su severidad. */
const EFFECT: Record<string, Partial<Record<Dest, string>>> = {
  "line-unconfirmed": {
    EEFF: "La línea no llega a Estados Financieros hasta que confirmes su PUC.",
    "1001": "La línea no entra al Formato 1001 hasta que confirmes su concepto.",
  },
  "puc-invalid": { EEFF: "La línea no puede enviarse a Estados Financieros con ese PUC." },
  "concept-invalid": { "1001": "La línea no puede reportarse en el Formato 1001 con ese concepto." },
  "title-unknown": { EEFF: "No se sabe si suma o resta, así que la factura no entra a Estados Financieros." },
  "third-incomplete": { "1001": "El Formato 1001 exige los datos completos del tercero y no se inventan." },
  "vat-year-unknown": { "1005": "Sin el perfil de IVA no se sabe si el Formato 1005 aplica.", "1006": "Sin el perfil de IVA no se sabe si el Formato 1006 aplica." },
  "retention-mismatch": { "1001": "No impide generar: se conserva la retención informada en la factura." },
};

const GENERIC: Record<Severity, (dest: Dest) => string> = {
  block: (d) => `Impide generar y exportar ${DEST_LABEL[d]} mientras no se resuelva.`,
  pending: (d) => `${DEST_LABEL[d]} no puede quedar listo hasta que confirmes este dato.`,
  review: (d) => `No impide generar ${DEST_LABEL[d]}, pero conviene revisarlo.`,
  info: () => "Solo informa.",
};

export interface PendingGroup {
  key: string;
  code: string;
  severity: Severity;
  /** Causa común, sin repetir una alerta por factura. */
  cause: string;
  /** Qué tan grande es: «12 líneas en 5 facturas», «3 proveedores», «Toda la empresa». */
  scope: string;
  documents: number;
  lines: number;
  /** Efecto concreto sobre el destino del panel. */
  effect: string;
  how: string;
  action: string;
  items: Alert[];
}

export interface PendingReport {
  dest: Dest;
  status: DestStatus;
  /** Justificación cuando el destino no aplica: en ese caso no hay lista de pendientes. */
  notApplicable?: string;
  summary: DestCounts;
  /** Líneas de facturas vigentes sin pendiente en este destino. */
  progress: { resolved: number; total: number } | null;
  groups: PendingGroup[];
}

export const progressText = (p: { resolved: number; total: number }) => `${p.resolved} de ${p.total} ${p.total === 1 ? "línea resuelta" : "líneas resueltas"}`;

/** Alertas del destino: las que no afectan a otro destino no aparecen, y las informativas nunca cuentan. */
export const alertsForDest = (alerts: readonly Alert[], dest: Dest) => alerts.filter((a) => a.severity !== "info" && a.dests.includes(dest));

function scopeText(code: string, items: Alert[], documents: number, lines: number): string {
  if (code === "third-incomplete") {
    const nits = new Set(items.map((a) => (a.target.kind === "supplier" ? a.target.nit : a.id)));
    return PLURAL(nits.size, "proveedor", "proveedores");
  }
  if (items.every((a) => a.docId === undefined)) return items.length === 1 ? "Toda la empresa y el año" : PLURAL(items.length, "caso", "casos");
  if (LINE_CODES.has(code)) return `${PLURAL(lines, "línea", "líneas")} en ${PLURAL(documents, "factura", "facturas")}`;
  return PLURAL(documents, "factura", "facturas");
}

export function buildPendingReport(model: PurchasesModel, dest: Dest): PendingReport {
  const notApplicable = model.notApplicable[dest];
  const own = notApplicable ? [] : alertsForDest(model.alerts, dest);

  const byKey = new Map<string, Alert[]>();
  for (const a of own) {
    // Los demás destinos que comparta la alerta no separan el grupo: aquí solo importa la causa.
    const key = `${a.severity}|${a.code}${a.variant ? `:${a.variant}` : ""}`;
    byKey.set(key, [...(byKey.get(key) ?? []), a]);
  }
  const groups: PendingGroup[] = [...byKey.entries()].map(([key, items]) => {
    const first = items[0];
    const docs = new Set(items.flatMap((a) => (a.docId === undefined ? [] : [a.docId])));
    const lineSet = new Set(items.flatMap((a) => (a.target.kind === "line" ? [`${a.target.docId}:${a.target.lineIndex}`] : [])));
    const lines = LINE_CODES.has(first.code) ? lineSet.size : 0;
    return {
      key,
      code: first.code,
      severity: first.severity,
      cause: CAUSE[first.variant ? `${first.code}:${first.variant}` : first.code] ?? CAUSE[first.code] ?? first.title,
      scope: scopeText(first.code, items, docs.size, lines),
      documents: docs.size,
      lines,
      effect: EFFECT[first.code]?.[dest] ?? GENERIC[first.severity](dest),
      how: first.how,
      action: first.action ?? "Resolver",
      items,
    };
  });

  return {
    dest,
    status: model.status[dest],
    notApplicable,
    summary: model.counts[dest],
    progress: lineProgress(model, dest),
    groups,
  };
}

/**
 * Avance en líneas: una línea queda sin resolver si ella (alerta de línea) o su factura entera (alerta de factura, proveedor o
 * encabezado) tiene un pendiente que afecta a este destino. Las alertas globales de empresa no cuentan líneas.
 */
export function lineProgress(model: PurchasesModel, dest: Dest): { resolved: number; total: number } | null {
  const counted = model.docs.filter((d) => d.counts);
  const total = counted.reduce((s, d) => s + d.lines.length, 0);
  if (total === 0) return null;
  const open = new Set<string>();
  const wholeDocs = new Set<number>();
  for (const a of alertsForDest(model.alerts, dest)) {
    if (a.docId === undefined) continue;
    if (LINE_CODES.has(a.code) && a.target.kind === "line") open.add(`${a.docId}:${a.target.lineIndex}`);
    else wholeDocs.add(a.docId);
  }
  let unresolved = 0;
  for (const d of counted) for (const l of d.lines) if (!l.notApplicable && (wholeDocs.has(d.doc.id) || open.has(`${d.doc.id}:${l.line.index}`))) unresolved += 1;
  return { resolved: total - unresolved, total };
}

export const SEVERITY_NOUN: Record<Exclude<Severity, "info">, string> = { block: "bloquean", pending: "por confirmar", review: "por revisar" };
export { SEVERITY_LABEL };

/**
 * El panel se oculta mientras se edita una factura, un proveedor o un encabezado desde él, y reaparece idéntico (mismo destino,
 * empresa y año) al cerrar ese editor.
 */
export function panelVisible(s: { panelDest: Dest | null; editing: boolean }): boolean {
  return s.panelDest !== null && !s.editing;
}
