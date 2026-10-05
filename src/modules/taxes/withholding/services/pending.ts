import { formatInteger } from "../../../../utils/format";
import type { DocRow, FiscalChange, FiscalConflict, PendingSupplier, UnknownTitle, WithholdingReport } from "../types";

/**
 * Fuente única de lo que requiere intervención del usuario en un análisis.
 * Se deriva del reporte (no cambia ningún cálculo): el panel de pendientes,
 * el estado del lote, el filtro «Pendientes» y el resaltado de filas leen de
 * aquí para no duplicar reglas.
 */

/** Bloqueante: impide incluir correctamente el documento en la declaración. */
export type PendingSeverity = "blocking" | "warning" | "info";

export type PendingCategory = "suppliers" | "documents" | "withholding" | "classification" | "fiscal";

export const PENDING_CATEGORIES: { id: PendingCategory; label: string }[] = [
  { id: "suppliers", label: "Proveedores" },
  { id: "documents", label: "Documentos" },
  { id: "withholding", label: "Retenciones" },
  { id: "classification", label: "Clasificaciones" },
  { id: "fiscal", label: "Datos fiscales" },
];

export type PendingGroup =
  | "supplier-config"
  | "supplier-person"
  | "supplier-rules"
  | "period"
  | "title"
  | "difference"
  | "manual-base"
  | "rule-choice"
  | "document-review"
  | "fiscal-conflict"
  | "fiscal-change"
  | "fiscal-missing"
  | "fiscal-unknown";

/** Frase del resumen por grupo: «2 proveedores sin configurar». */
const GROUP_LABEL: Record<PendingGroup, [one: string, many: string]> = {
  "supplier-config": ["proveedor sin configurar", "proveedores sin configurar"],
  "supplier-person": ["proveedor sin PJ / PN", "proveedores sin PJ / PN"],
  "supplier-rules": ["proveedor sin tipo y subtipo de retención", "proveedores sin tipo y subtipo de retención"],
  period: ["periodo por elegir", "periodos por elegir"],
  title: ["título de documento sin clasificar", "títulos de documento sin clasificar"],
  difference: ["documento con diferencia de retención", "documentos con diferencia de retención"],
  "manual-base": ["documento con base manual pendiente", "documentos con base manual pendiente"],
  "rule-choice": ["documento con reglas de retención por definir", "documentos con reglas de retención por definir"],
  "document-review": ["documento por revisar", "documentos por revisar"],
  "fiscal-conflict": ["proveedor con régimen fiscal en conflicto", "proveedores con régimen fiscal en conflicto"],
  "fiscal-change": ["cambio de régimen fiscal por confirmar", "cambios de régimen fiscal por confirmar"],
  "fiscal-missing": ["proveedor sin régimen fiscal asignado", "proveedores sin régimen fiscal asignado"],
  "fiscal-unknown": ["proveedor sin régimen fiscal (no viene en la factura)", "proveedores sin régimen fiscal (no viene en la factura)"],
};

export const groupLabel = (group: PendingGroup, n: number) => `${formatInteger(n)} ${GROUP_LABEL[group][n === 1 ? 0 : 1]}`;

export type PendingTarget =
  | { kind: "supplier"; supplier: PendingSupplier }
  | { kind: "document"; fileName: string }
  | { kind: "title"; title: UnknownTitle }
  | { kind: "period" }
  | { kind: "fiscal-conflict"; conflict: FiscalConflict }
  | { kind: "fiscal-change"; change: FiscalChange }
  | { kind: "fiscal-missing"; item: WithholdingReport["fiscalMissing"][number] }
  | { kind: "fiscal-unknown"; item: WithholdingReport["fiscalUnknown"][number] };

export interface PendingAction {
  id: string;
  severity: PendingSeverity;
  category: PendingCategory;
  group: PendingGroup;
  /** Proveedor, documento o título al que se refiere. */
  title: string;
  /** Qué falta. */
  detail: string;
  /** Texto del botón que lo resuelve. */
  actionLabel: string;
  target: PendingTarget;
  /** Documentos del lote afectados (para resaltar filas y filtrar). */
  fileNames: string[];
}

const SEVERITY_ORDER: PendingSeverity[] = ["blocking", "warning", "info"];
const CATEGORY_ORDER = PENDING_CATEGORIES.map((c) => c.id);

const docLabel = (r: DocRow) => r.number ?? r.fileName;

function documentAction(r: DocRow): PendingAction | undefined {
  const base = { severity: "blocking" as const, target: { kind: "document" as const, fileName: r.fileName }, fileNames: [r.fileName], title: `${docLabel(r)}${r.supplierName ? ` — ${r.supplierName}` : ""}` };
  switch (r.status) {
    case "difference":
      return { ...base, id: `doc:${r.fileName}`, category: "withholding", group: "difference", detail: r.issues[0] ?? "Diferencia de retención.", actionLabel: "Revisar" };
    case "pending-base":
      return { ...base, id: `doc:${r.fileName}`, category: "withholding", group: "manual-base", detail: r.lines.length > 1 ? (r.issues[0] ?? "Falta la base de una regla.") : "Indica la base de retención de este documento.", actionLabel: "Indicar base" };
    case "review": {
      const choice = r.lines.some((l) => l.state === "pending");
      return {
        ...base,
        id: `doc:${r.fileName}`,
        category: choice ? "withholding" : "documents",
        group: choice ? "rule-choice" : "document-review",
        detail: r.issues[0] ?? "Requiere revisión.",
        actionLabel: choice ? "Definir reglas" : "Revisar",
      };
    }
    default:
      return undefined;
  }
}

function supplierGroup(p: PendingSupplier): { group: PendingGroup; detail: string } {
  if (!p.supplierId) return { group: "supplier-config", detail: "Proveedor nuevo: falta PJ / PN, tipo, subtipo y modo de base" };
  const person = p.missing.includes("PJ / PN");
  const rules = p.missing.includes("reglas de retención");
  if (person && rules) return { group: "supplier-config", detail: "Falta PJ / PN, tipo, subtipo y modo de base" };
  if (person) return { group: "supplier-person", detail: "Falta PJ / PN" };
  return { group: "supplier-rules", detail: "Falta tipo, subtipo y modo de base de retención" };
}

const docsText = (n: number) => (n === 1 ? "1 documento" : `${formatInteger(n)} documentos`);

/** Pendientes del reporte, ordenados: bloqueantes primero, luego por categoría. */
export function buildPendingActions(report: WithholdingReport, resolvedConflicts: ReadonlySet<string> = new Set()): PendingAction[] {
  const actions: PendingAction[] = [];
  const rows = report.rows;

  if (report.period.months.length > 0 && !report.period.key) {
    actions.push({
      id: "period",
      severity: "blocking",
      category: "documents",
      group: "period",
      title: "Periodo del lote",
      detail: "Hay el mismo número de documentos en varios meses: elige el periodo a procesar.",
      actionLabel: "Elegir periodo",
      target: { kind: "period" },
      fileNames: rows.filter((r) => r.status === "pending-period").map((r) => r.fileName),
    });
  }

  for (const p of report.pendingSuppliers) {
    const { group, detail } = supplierGroup(p);
    actions.push({
      id: `supplier:${p.nit}`,
      severity: "blocking",
      category: "suppliers",
      group,
      title: p.name || `NIT ${p.nit}`,
      detail: `${detail} (${docsText(p.documentCount)}).`,
      actionLabel: "Configurar ahora",
      target: { kind: "supplier", supplier: p },
      fileNames: rows.filter((r) => r.status === "pending-supplier" && r.nit === p.nit).map((r) => r.fileName),
    });
  }

  for (const t of report.unknownTitles) {
    actions.push({
      id: `title:${t.normalizedTitle}`,
      severity: "blocking",
      category: "classification",
      group: "title",
      title: t.displayTitle,
      detail: `Indica si es Factura o Nota (${docsText(t.documentCount)}).`,
      actionLabel: "Clasificar",
      target: { kind: "title", title: t },
      fileNames: rows.filter((r) => r.status === "pending-title" && r.titleKey === t.normalizedTitle).map((r) => r.fileName),
    });
  }

  for (const r of rows) {
    const a = documentAction(r);
    if (a) actions.push(a);
  }

  for (const c of report.fiscalConflicts) {
    if (resolvedConflicts.has(c.nit)) continue;
    actions.push({
      id: `fiscal-conflict:${c.nit}`,
      severity: "blocking",
      category: "fiscal",
      group: "fiscal-conflict",
      title: c.name || `NIT ${c.nit}`,
      detail: `Códigos fiscales diferentes en el lote: ${c.variants.map((v) => v.regime).join(" · ")}.`,
      actionLabel: "Confirmar régimen",
      target: { kind: "fiscal-conflict", conflict: c },
      fileNames: c.variants.flatMap((v) => v.files),
    });
  }

  for (const c of report.fiscalChanges) {
    actions.push({
      id: `fiscal-change:${c.nit}`,
      severity: "warning",
      category: "fiscal",
      group: "fiscal-change",
      title: c.name || `NIT ${c.nit}`,
      detail: `Guardado: ${c.stored} · Detectado ahora: ${c.detected}.`,
      actionLabel: "Confirmar",
      target: { kind: "fiscal-change", change: c },
      fileNames: c.files,
    });
  }

  // Sin régimen asignado no se puede saber si aplica O-15 / O-47: bloqueante.
  for (const m of report.fiscalMissing) {
    actions.push({
      id: `fiscal-missing:${m.nit}`,
      severity: "blocking",
      category: "fiscal",
      group: "fiscal-missing",
      title: m.name || `NIT ${m.nit}`,
      detail: `El proveedor no tiene régimen asignado; la factura trae ${m.detected}.`,
      actionLabel: "Asignar régimen",
      target: { kind: "fiscal-missing", item: m },
      fileNames: rows.filter((r) => r.nit === m.nit && r.periodKey === report.period.key && r.status !== "duplicate").map((r) => r.fileName),
    });
  }

  for (const u of report.fiscalUnknown) {
    actions.push({
      id: `fiscal-unknown:${u.nit}`,
      severity: "blocking",
      category: "fiscal",
      group: "fiscal-unknown",
      title: u.name || `NIT ${u.nit}`,
      detail: `El proveedor no tiene régimen asignado y la factura no lo muestra (${docsText(u.files.length)}): escríbelo.`,
      actionLabel: "Asignar régimen",
      target: { kind: "fiscal-unknown", item: u },
      fileNames: u.files,
    });
  }

  return actions.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
}

/** Pendientes que requieren acción (bloqueantes y advertencias). */
export const actionable = (actions: PendingAction[]) => actions.filter((a) => a.severity !== "info");

export type LotStatus = { kind: "ready"; warnings: number } | { kind: "attention"; pending: number; blocking: number };

/** «Listo para declaración» solo sin pendientes bloqueantes. */
export function lotStatus(actions: PendingAction[]): LotStatus {
  const blocking = actions.filter((a) => a.severity === "blocking").length;
  const warnings = actions.filter((a) => a.severity === "warning").length;
  return blocking > 0 ? { kind: "attention", pending: blocking + warnings, blocking } : { kind: "ready", warnings };
}

/** Frases del resumen: una por grupo, en el orden de los pendientes. */
export function groupSummary(actions: PendingAction[]): { group: PendingGroup; severity: PendingSeverity; count: number; firstId: string }[] {
  const out: { group: PendingGroup; severity: PendingSeverity; count: number; firstId: string }[] = [];
  for (const a of actions) {
    const g = out.find((x) => x.group === a.group);
    if (g) g.count++;
    else out.push({ group: a.group, severity: a.severity, count: 1, firstId: a.id });
  }
  return out;
}

/** Primer pendiente accionable para «Resolver pendientes», opcionalmente saltando uno. */
export const nextPending = (actions: PendingAction[], skipId?: string) => actionable(actions).find((a) => a.id !== skipId);

/** Pendiente más grave por archivo (para resaltar filas de la tabla). */
export function actionsByFile(actions: PendingAction[]): Map<string, PendingAction> {
  const map = new Map<string, PendingAction>();
  for (const a of actionable(actions)) for (const f of a.fileNames) if (!map.has(f)) map.set(f, a);
  return map;
}
