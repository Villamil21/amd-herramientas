import { formatInteger } from "../../../../utils/format";
import type { InvoiceReport, InvoiceRow, PendingSupplier, UnknownTitle } from "../types";
import { needsAttention } from "./analysis";

/**
 * Fuente única de lo que requiere intervención del usuario en un análisis de
 * IVA de compras. Se deriva del reporte (no cambia ningún cálculo): el panel
 * «Pendientes por resolver», el estado global, el filtro «Pendientes» y el
 * resaltado de filas leen de aquí para no duplicar reglas.
 *
 * Todo pendiente es bloqueante: mientras exista uno el lote no está «Listo
 * para declaración». Lo informativo (filas interpretadas como 0 %, redondeos,
 * documentos excluidos) queda en las notas de cada documento.
 */

export type PendingCategory = "suppliers" | "classification" | "documents";

export const PENDING_CATEGORIES: { id: PendingCategory; label: string }[] = [
  { id: "suppliers", label: "Proveedores" },
  { id: "classification", label: "Tipos de documento" },
  { id: "documents", label: "Documentos" },
];

export type PendingGroup = "supplier" | "title" | "product" | "document" | "duplicate" | "failed";

/** Frase del resumen por grupo: «2 proveedores sin Tipo IVA». */
const GROUP_LABEL: Record<PendingGroup, [one: string, many: string]> = {
  supplier: ["proveedor sin Tipo IVA", "proveedores sin Tipo IVA"],
  title: ["nuevo tipo de documento sin clasificar", "nuevos tipos de documento sin clasificar"],
  product: ["documento con productos no interpretados", "documentos con productos no interpretados"],
  document: ["documento por revisar", "documentos por revisar"],
  duplicate: ["documento duplicado por revisar", "documentos duplicados por revisar"],
  failed: ["documento con información incompleta", "documentos con información incompleta"],
};

export const groupLabel = (group: PendingGroup, n: number) => `${formatInteger(n)} ${GROUP_LABEL[group][n === 1 ? 0 : 1]}`;

export type PendingTarget = { kind: "supplier"; supplier: PendingSupplier } | { kind: "title"; title: UnknownTitle } | { kind: "document"; fileName: string };

export interface PendingAction {
  id: string;
  category: PendingCategory;
  group: PendingGroup;
  /** Proveedor, documento o título al que se refiere. */
  title: string;
  /** Qué pasó y qué falta. */
  detail: string;
  /** Texto del botón que lo resuelve. */
  actionLabel: string;
  target: PendingTarget;
  /** Documentos del lote afectados (para resaltar filas y filtrar). */
  fileNames: string[];
}

const docsText = (n: number) => (n === 1 ? "1 documento" : `${formatInteger(n)} documentos`);

function documentAction(r: InvoiceRow): PendingAction | undefined {
  const base = { id: `doc:${r.fileName}`, category: "documents" as const, target: { kind: "document" as const, fileName: r.fileName }, fileNames: [r.fileName] };
  if (r.status === "incompatible" || r.status === "error") {
    return { ...base, group: "failed", title: r.fileName, detail: r.issues[0] ?? "No fue posible leer el documento.", actionLabel: "Revisar" };
  }
  if (r.status !== "review") return undefined;
  const title = `${r.invoiceNumber ?? r.fileName}${r.supplierName ? ` — ${r.supplierName}` : ""}`;
  const first = r.problems[0];
  if (first.code === "lines") return { ...base, group: "product", title, detail: first.text, actionLabel: "Revisar producto" };
  if (first.code === "duplicate") return { ...base, group: "duplicate", title, detail: first.text, actionLabel: "Revisar duplicado" };
  // El botón abre el documento: allí están «Confirmar interpretación», «Excluir documento», etc.
  return { ...base, group: "document", title, detail: first.text, actionLabel: first.code === "services-5" ? "Editar proveedor" : "Revisar" };
}

/** Pendientes del reporte: proveedores, tipos de documento y luego documentos (en el orden de la carpeta). */
export function buildPendingActions(report: InvoiceReport): PendingAction[] {
  const actions: PendingAction[] = [];
  const active = report.rows.filter(needsAttention);

  for (const p of report.pendingSuppliers) {
    actions.push({
      id: `supplier:${p.nit}`,
      category: "suppliers",
      group: "supplier",
      title: p.name || `NIT ${p.nit}`,
      detail: `NIT ${p.nit}: falta indicar si es Compras o Servicios (${docsText(p.invoiceCount)}).`,
      actionLabel: "Configurar proveedor",
      target: { kind: "supplier", supplier: p },
      fileNames: active.filter((r) => r.supplierNit === p.nit).map((r) => r.fileName),
    });
  }

  for (const t of report.unknownTitles) {
    actions.push({
      id: `title:${t.normalizedTitle}`,
      category: "classification",
      group: "title",
      title: t.displayTitle,
      detail: `Se encontró un nuevo tipo de documento (${docsText(t.documentCount)}): indica si es Factura electrónica o Nota crédito.`,
      actionLabel: "Clasificar documento",
      target: { kind: "title", title: t },
      fileNames: active.filter((r) => r.documentTypeKey === t.normalizedTitle && !r.category).map((r) => r.fileName),
    });
  }

  for (const r of report.rows) {
    const a = documentAction(r);
    if (a) actions.push(a);
  }
  return actions;
}

export type LotStatus = { kind: "ready" } | { kind: "attention"; pending: number };

/** «Listo para declaración» solo cuando no queda ningún pendiente. */
export const lotStatus = (actions: PendingAction[]): LotStatus => (actions.length ? { kind: "attention", pending: actions.length } : { kind: "ready" });

/** Frases del resumen: una por grupo, en el orden de los pendientes (20 documentos iguales → una sola frase). */
export function groupSummary(actions: PendingAction[]): { group: PendingGroup; count: number; firstId: string }[] {
  const out: { group: PendingGroup; count: number; firstId: string }[] = [];
  for (const a of actions) {
    const g = out.find((x) => x.group === a.group);
    if (g) g.count++;
    else out.push({ group: a.group, count: 1, firstId: a.id });
  }
  return out;
}

/** Siguiente pendiente para «Resolver pendientes», opcionalmente saltando uno. */
export const nextPending = (actions: PendingAction[], skipId?: string) => actions.find((a) => a.id !== skipId);

/**
 * Pendiente que se resuelve en cada archivo (para resaltar filas de la tabla):
 * primero el propio del documento; si no tiene, el de su proveedor o título.
 */
export function actionsByFile(actions: PendingAction[]): Map<string, PendingAction> {
  const map = new Map<string, PendingAction>();
  for (const a of actions) if (a.target.kind === "document") map.set(a.target.fileName, a);
  for (const a of actions) for (const f of a.fileNames) if (!map.has(f)) map.set(f, a);
  return map;
}
