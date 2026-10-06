import { formatInteger } from "../../../../utils/format";
import type { DocRow, ProblemCode, PucReport, UnknownTitle } from "../types";
import { needsAttention } from "./analysis";

/**
 * Fuente única de lo que falta por resolver en un análisis de Códigos PUC por
 * factura. Se deriva del reporte (no cambia ningún cálculo): el bloque
 * «Pendientes por resolver», el estado global, «Siguiente pendiente», el
 * resaltado de filas y el bloqueo de «Exportar Excel» leen de aquí.
 *
 * Todo pendiente es bloqueante: mientras exista uno no se puede exportar.
 */

export type PendingCategory = "classification" | "documents";

export const PENDING_CATEGORIES: { id: PendingCategory; label: string }[] = [
  { id: "classification", label: "Títulos de documento" },
  { id: "documents", label: "Facturas" },
];

export type PendingGroup = "title" | "failed" | "review" | "duplicate" | "mode" | "code";

/** Frase del resumen por grupo: «3 facturas sin modalidad de asignación». */
const GROUP_LABEL: Record<PendingGroup, [one: string, many: string]> = {
  title: ["título de documento sin clasificar", "títulos de documento sin clasificar"],
  failed: ["archivo que no se pudo leer", "archivos que no se pudieron leer"],
  review: ["documento que requiere revisión", "documentos que requieren revisión"],
  duplicate: ["duplicado pendiente de resolver", "duplicados pendientes de resolver"],
  mode: ["factura sin modalidad de asignación", "facturas sin modalidad de asignación"],
  code: ["factura con códigos PUC por asignar", "facturas con códigos PUC por asignar"],
};

export const groupLabel = (group: PendingGroup, n: number) => `${formatInteger(n)} ${GROUP_LABEL[group][n === 1 ? 0 : 1]}`;

/** Nombre corto de cada problema (encabezado del pendiente). */
export const PROBLEM_TITLE: Record<ProblemCode, string> = {
  "title-missing": "Documento que requiere revisión",
  duplicate: "Duplicado pendiente de resolver",
  "no-mode": "Factura sin modalidad de asignación",
  "no-code": "Código PUC sin asignar",
  "invalid-code": "Código inválido",
  "gross-missing": "Total Bruto Factura no identificado",
  "no-products": "Documento sin productos",
  "lines-unread": "Descripción o Precio unitario de venta no interpretado",
  "lines-without-code": "Producto sin código PUC",
};

const PROBLEM_GROUP: Record<ProblemCode, PendingGroup> = {
  "title-missing": "review",
  duplicate: "duplicate",
  "no-mode": "mode",
  "no-code": "code",
  "invalid-code": "code",
  "gross-missing": "review",
  "no-products": "review",
  "lines-unread": "review",
  "lines-without-code": "code",
};

/** Qué problema encabeza el pendiente de un documento con varios. */
const PRIORITY: ProblemCode[] = ["title-missing", "duplicate", "gross-missing", "no-products", "lines-unread", "invalid-code", "no-mode", "no-code", "lines-without-code"];

export type PendingTarget = { kind: "title"; title: UnknownTitle } | { kind: "document"; fileName: string };

export interface PendingAction {
  id: string;
  category: PendingCategory;
  group: PendingGroup;
  /** Qué falta («Producto sin código PUC»). */
  what: string;
  /** En qué factura o título está. */
  where: string;
  detail: string;
  /** Texto del botón que lo resuelve. */
  actionLabel: string;
  target: PendingTarget;
  /** Documentos del lote afectados (para resaltar filas). */
  fileNames: string[];
}

const docsText = (n: number) => (n === 1 ? "1 documento" : `${formatInteger(n)} documentos`);

export const documentLabel = (r: Pick<DocRow, "fileName" | "number" | "issuerName">) => `${r.number ?? r.fileName}${r.issuerName ? ` — ${r.issuerName}` : ""}`;

function documentAction(r: DocRow): PendingAction | undefined {
  if (r.excluded) return undefined;
  const base = { id: `doc:${r.fileName}`, category: "documents" as const, target: { kind: "document" as const, fileName: r.fileName }, fileNames: [r.fileName] };
  if (r.failure) return { ...base, group: "failed", what: "Documento que requiere revisión", where: r.fileName, detail: r.failure.message, actionLabel: "Revisar" };
  const first = PRIORITY.map((code) => r.problems.find((p) => p.code === code)).find(Boolean);
  if (!first) return undefined;
  const group = PROBLEM_GROUP[first.code];
  const actionLabel = group === "mode" ? "Elegir modalidad" : group === "code" ? "Asignar código" : group === "duplicate" ? "Revisar duplicado" : "Revisar";
  const others = r.problems.length - 1;
  return { ...base, group, what: PROBLEM_TITLE[first.code], where: documentLabel(r), detail: others > 0 ? `${first.text} (y ${others} más)` : first.text, actionLabel };
}

/** Pendientes del reporte: primero los títulos (afectan a varios documentos) y luego cada factura, en el orden de la carpeta. */
export function buildPendingActions(report: PucReport): PendingAction[] {
  const actions: PendingAction[] = [];
  for (const t of report.unknownTitles) {
    actions.push({
      id: `title:${t.normalizedTitle}`,
      category: "classification",
      group: "title",
      what: "Título de documento sin clasificar",
      where: t.displayTitle,
      detail: `Título detectado en ${docsText(t.documentCount)}. ¿Dónde deseas clasificarlo?`,
      actionLabel: "Clasificar",
      target: { kind: "title", title: t },
      fileNames: report.rows.filter((r) => needsAttention(r) && r.titleKey === t.normalizedTitle && !r.category).map((r) => r.fileName),
    });
  }
  for (const r of report.rows) {
    const a = documentAction(r);
    if (a) actions.push(a);
  }
  return actions;
}

/** Frases del resumen: una por grupo, en el orden de los pendientes. */
export function groupSummary(actions: PendingAction[]): { group: PendingGroup; count: number; firstId: string }[] {
  const out: { group: PendingGroup; count: number; firstId: string }[] = [];
  for (const a of actions) {
    const g = out.find((x) => x.group === a.group);
    if (g) g.count++;
    else out.push({ group: a.group, count: 1, firstId: a.id });
  }
  return out;
}

/** Siguiente pendiente, opcionalmente después de uno dado (da la vuelta al llegar al final). */
export function nextPending(actions: PendingAction[], afterId?: string): PendingAction | undefined {
  const others = actions.filter((a) => a.id !== afterId);
  if (!afterId || others.length === 0) return others[0];
  const at = actions.findIndex((a) => a.id === afterId);
  return at === -1 ? others[0] : (actions.slice(at + 1).find((a) => a.id !== afterId) ?? others[0]);
}

/**
 * Pendiente que se resuelve en cada archivo (para resaltar filas de la tabla):
 * primero el propio del documento; si no tiene, el de su título.
 */
export function actionsByFile(actions: PendingAction[]): Map<string, PendingAction> {
  const map = new Map<string, PendingAction>();
  for (const a of actions) if (a.target.kind === "document") map.set(a.target.fileName, a);
  for (const a of actions) for (const f of a.fileNames) if (!map.has(f)) map.set(f, a);
  return map;
}

/** Exportar solo con cero pendientes y algo que exportar. No hay forma de omitirlo. */
export function exportBlock(report: PucReport, actions: PendingAction[]): string | null {
  if (actions.length > 0) return actions.length === 1 ? "Falta 1 pendiente por resolver." : `Faltan ${formatInteger(actions.length)} pendientes por resolver.`;
  if (report.summary.length === 0) return "No hay facturas clasificadas para exportar.";
  return null;
}
