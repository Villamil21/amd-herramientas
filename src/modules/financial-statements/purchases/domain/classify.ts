import type { PurchaseLine, PurchaseRule, RetentionPick, YearConcept } from "../../../../types/purchases";
import type { Supplier } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";
import { isAssignable, type PucIndex } from "../../puc-codes/services/pucCatalog";

/**
 * Clasificación por línea. Cada línea puede tener su propio PUC, su propio concepto 1001 y sus propios conceptos de retención.
 *
 * Una propuesta NUNCA se confirma sola: toda línea nueva queda «Por confirmar». Prioridad de la propuesta:
 *   1. Regla confirmada para el producto de ese proveedor.
 *   2. Sugerencia de la cuenta PUC (el concepto 1001 sugerido en la Tabla de Códigos PUC).
 *   3. Sugerencia general (lo más usado por el proveedor en sus otras reglas).
 */

/**
 * PUC especial «7305 — NO APLICA»: la línea queda intencionalmente excluida. No alimenta Estados Financieros ni ningún
 * formato exógeno (1001, 1005, 1006), no genera retenciones y no exige concepto 1001. Se confirma como cualquier otra
 * clasificación, pero cuenta como resuelta para todos los destinos.
 */
export const NOT_APPLICABLE_PUC = "7305";
export const NOT_APPLICABLE_LABEL = "NO APLICA";
export const NOT_APPLICABLE_MESSAGE = "No aplica: esta línea no se enviará a Estados Financieros ni a Exógena.";

export const isNotApplicablePuc = (code: string | undefined | null): boolean => code === NOT_APPLICABLE_PUC;

/** Una clasificación con 7305 no puede conservar concepto 1001 ni retenciones: se limpian aquí, no solo en pantalla. */
export function normalizeClassification<T extends { pucCode: string; concept1001: string; retention: RetentionPick[] }>(c: T): T {
  return isNotApplicablePuc(c.pucCode) ? { ...c, concept1001: "", retention: [] } : c;
}

/** Identidad del producto de un proveedor: su código del PDF o, sin código, su descripción normalizada. */
export function productKey(line: Pick<PurchaseLine, "code" | "description">): string {
  const code = normalizeKey(line.code ?? "");
  return code ? `c:${code}` : `d:${normalizeKey(line.description ?? "")}`;
}

export type ProposalSource = "rule" | "puc" | "general" | "supplier" | "history";

export const PROPOSAL_SOURCE_LABEL: Record<ProposalSource, string> = {
  rule: "Regla confirmada del producto",
  puc: "Sugerencia de la cuenta PUC",
  general: "Sugerencia general del proveedor",
  supplier: "Retención predeterminada del proveedor",
  history: "Sugerida por factura confirmada del proveedor",
};

/** Texto del origen de un dato propuesto; el de historial lleva la fecha de la factura confirmada («… del 15/02/2026»). */
export function proposalSourceText(source: ProposalSource, historyDate?: string): string {
  if (source !== "history" || !historyDate) return PROPOSAL_SOURCE_LABEL[source];
  const [y, m, d] = historyDate.split("-");
  return `${PROPOSAL_SOURCE_LABEL.history} del ${d}/${m}/${y}`;
}

/** Línea de una factura anterior del proveedor que el usuario ya confirmó (nunca una propuesta pendiente). */
export interface RetentionHistoryEntry {
  productKey: string;
  pucCode: string;
  concept1001: string;
  retention: RetentionPick[];
  /** Fecha de expedición de esa factura (AAAA-MM-DD). */
  date: string;
  confirmedAt: string;
}

/**
 * Retención que el usuario confirmó antes para el proveedor: la más reciente del mismo producto o, si no hay, la más reciente
 * de una clasificación equivalente (mismo PUC y, si se propone, mismo concepto 1001). Solo los conceptos: la tarifa, la
 * cuantía mínima y la vigencia salen de la fecha de la factura nueva.
 */
export function historyRetention(history: readonly RetentionHistoryEntry[], key: string, pucCode: string, concept: string): RetentionHistoryEntry | undefined {
  const latest = (items: RetentionHistoryEntry[]) => items.sort((a, b) => (a.date === b.date ? (a.confirmedAt < b.confirmedAt ? 1 : -1) : a.date < b.date ? 1 : -1))[0];
  const sameProduct = latest(history.filter((h) => h.productKey === key));
  if (sameProduct) return sameProduct;
  if (!pucCode) return undefined;
  return latest(history.filter((h) => h.pucCode === pucCode && (!concept || h.concept1001 === concept)));
}

export interface Proposal {
  pucCode: string;
  concept1001: string;
  retention: RetentionPick[];
  /** De dónde salió cada dato (puede ser distinto para cada uno). */
  sources: { puc?: ProposalSource; concept?: ProposalSource; retention?: ProposalSource };
  /** Fecha de la factura confirmada de la que sale la retención sugerida por historial. */
  retentionFrom?: string;
  ruleId?: number;
}

export interface ProposalContext {
  rulesByKey: Map<string, PurchaseRule>;
  /** Concepto 1001 sugerido por cuenta PUC (Tabla de Códigos PUC). */
  pucConcepts: ReadonlyMap<string, string>;
  /** Reglas del proveedor (para la sugerencia general). */
  supplierRules: readonly PurchaseRule[];
  supplier?: Supplier;
  /** Líneas confirmadas de facturas anteriores del proveedor (con un régimen que sí retenía en su fecha). */
  history?: readonly RetentionHistoryEntry[];
}

const mostFrequent = (values: string[]): string | undefined => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
};

/** Concepto 1001 sugerido para una cuenta: la misma, o la de su cuenta de cuatro dígitos / grupo. */
export function conceptForPuc(pucConcepts: ReadonlyMap<string, string>, pucCode: string): string | undefined {
  if (!pucCode) return undefined;
  for (const len of [pucCode.length, 6, 4]) {
    const hit = pucConcepts.get(pucCode.slice(0, len));
    if (hit) return hit;
  }
  return undefined;
}

/** Retención predeterminada del proveedor (Proveedores → reglas de retención marcadas como predeterminadas). */
export function supplierDefaultRetention(supplier: Supplier | undefined): RetentionPick[] {
  return (supplier?.withholdingRules ?? []).filter((r) => r.isDefault).map((r) => ({ rateId: r.rateId }));
}

export function proposeLine(line: PurchaseLine, ctx: ProposalContext): Proposal {
  const rule = ctx.rulesByKey.get(productKey(line));
  const sources: Proposal["sources"] = {};
  let pucCode = "";
  let concept = "";
  let retention: RetentionPick[] = [];

  if (rule) {
    if (rule.pucCode) {
      pucCode = rule.pucCode;
      sources.puc = "rule";
    }
    if (rule.concept1001) {
      concept = rule.concept1001;
      sources.concept = "rule";
    }
    if (rule.retention.length) {
      retention = rule.retention;
      sources.retention = "rule";
    }
  }
  if (!pucCode) {
    // Sin regla del producto: el PUC más usado por el proveedor en sus otras reglas.
    const general = mostFrequent(ctx.supplierRules.map((r) => r.pucCode));
    if (general) {
      pucCode = general;
      sources.puc = "general";
    }
  }
  if (!concept) {
    const fromPuc = conceptForPuc(ctx.pucConcepts, pucCode);
    if (fromPuc) {
      concept = fromPuc;
      sources.concept = "puc";
    } else {
      const general = mostFrequent(ctx.supplierRules.map((r) => r.concept1001));
      if (general) {
        concept = general;
        sources.concept = "general";
      }
    }
  }
  let retentionFrom: string | undefined;
  if (retention.length === 0 && ctx.history?.length && !isNotApplicablePuc(pucCode)) {
    const hit = historyRetention(ctx.history, productKey(line), pucCode, concept);
    if (hit?.retention.length) {
      retention = hit.retention;
      retentionFrom = hit.date;
      sources.retention = "history";
    }
  }
  if (retention.length === 0) {
    const fromSupplier = supplierDefaultRetention(ctx.supplier);
    if (fromSupplier.length) {
      retention = fromSupplier;
      sources.retention = "supplier";
    }
  }
  if (isNotApplicablePuc(pucCode)) {
    // 7305: sin concepto 1001 ni retención, ni siquiera sugeridos por el PUC o por el proveedor.
    return { pucCode, concept1001: "", retention: [], sources: { puc: sources.puc }, ruleId: rule?.id };
  }
  return { pucCode, concept1001: concept, retention, sources, retentionFrom, ruleId: rule?.id };
}

/** Clases del PUC que pueden recibir compras: 1 activo · 5 gastos · 6 costos de ventas · 7 costos de producción. */
const PURCHASE_CLASSES = new Set(["1", "5", "6", "7"]);

export const CLASS_LABEL: Record<string, string> = { "1": "activo", "2": "pasivo", "3": "patrimonio", "4": "ingresos", "5": "gastos", "6": "costos de ventas", "7": "costos de producción", "8": "cuentas de orden deudoras", "9": "cuentas de orden acreedoras" };

/** Por qué una cuenta no sirve para una compra (undefined = sirve). */
export function pucProblem(index: PucIndex, code: string): string | undefined {
  if (!code) return "Falta el código PUC.";
  if (isNotApplicablePuc(code)) return undefined;
  if (!isAssignable(index, code)) return `El código ${code} no existe en la Tabla de Códigos PUC o no es una subcuenta asignable.`;
  if (index.inactive.has(code)) return `El código ${code} está inactivo en la Tabla de Códigos PUC.`;
  if (!PURCHASE_CLASSES.has(code[0])) return `El código ${code} es de ${CLASS_LABEL[code[0]] ?? "otra clase"}: una compra solo va a cuentas de activo, costo o gasto (no genera saldos por pagar).`;
  return undefined;
}

/** Por qué un concepto 1001 no sirve para la fecha de la factura (undefined = sirve). */
export function conceptProblem(concepts: readonly YearConcept[], code: string, date: string | null): string | undefined {
  if (!code) return "Falta el concepto 1001.";
  const found = concepts.find((c) => c.code === code);
  if (!found) return `El concepto ${code} no está en el catálogo 1001 del año de la factura.`;
  if (!found.isActive) return `El concepto ${code} está inactivo en el catálogo 1001.`;
  if (date && (date < found.validFrom || (found.validTo && date > found.validTo))) return `El concepto ${code} no estaba vigente el ${date}.`;
  return undefined;
}

export const conceptName = (concepts: readonly YearConcept[], code: string) => concepts.find((c) => c.code === code)?.description ?? "";
