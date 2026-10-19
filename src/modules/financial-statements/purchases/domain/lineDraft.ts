import type { LineClassInput, RateVersion, RetentionPick } from "../../../../types/purchases";
import { RETENTION_TYPE_LABEL, type RetentionType, type UvtValue, type WithholdingRate } from "../../../../types/models";
import { formatRateBp, minBaseCents, retentionCents } from "../../../taxes/withholding/services/money";
import { normalizeKey } from "../../../../utils/text";
import { rateAt } from "./rateVersions";
import { allocate, isInvoiceLevel } from "./retention";
import { lineLabel, type LineView } from "./model";
import { isNotApplicablePuc, normalizeClassification, productKey } from "./classify";

/**
 * Borrador de la clasificación de UNA línea (lo que edita el panel «Clasificar»). Funciones puras: el panel solo las llama,
 * así que «ninguna, una o varias retenciones» se prueba sin montar la pantalla.
 */

export interface RetentionPreview {
  rateId: number;
  name: string;
  /** Base de la línea (sin signo). */
  baseCents: number;
  /** Base del concepto en toda la factura: sobre ella se evalúa la cuantía mínima (igual que el cálculo de la factura). */
  conceptBaseCents: number;
  minCents: number;
  rateBp: number;
  /** Fecha desde la que rige la tarifa aplicada; sin ella rige la regla base de la tabla. */
  appliedFrom?: string;
  /** Falta el UVT del año: no se puede evaluar la cuantía mínima. */
  missingUvt: boolean;
  belowMinimum: boolean;
  /** Retención de esta línea con la tarifa vigente en la fecha de la factura (0 si no supera el mínimo). En una retención de factura es su parte del total. */
  valueCents: number;
  /** El concepto está en todas las líneas incluidas: se evalúa y se calcula una sola vez sobre el subtotal de la factura. */
  invoiceLevel: boolean;
  /** Retención de factura completa (subtotal × tarifa); igual para todas las líneas, no se suma por línea. */
  invoiceValueCents: number;
}

/** Líneas incluidas de la factura (sin 7305) y posición de la que se edita: permite repartir una retención común sin perder centavos. */
export interface InvoiceBases {
  bases: readonly number[];
  index: number;
}

/** Qué retiene un concepto sobre una línea, con la tarifa, la cuantía mínima y el UVT vigentes en la fecha de la factura. */
export function previewRetention(rate: WithholdingRate, versions: readonly RateVersion[], date: string | null | undefined, uvts: readonly UvtValue[], baseCents: number, conceptBaseCents = baseCents, common?: InvoiceBases): RetentionPreview {
  const applied = rateAt(rate, versions, date);
  const year = date ? Number(date.slice(0, 4)) : null;
  const uvt = year === null ? undefined : uvts.find((u) => u.year === year);
  const minCents = uvt ? minBaseCents(applied.baseUvtCenti, uvt.valuePesos) : 0;
  const belowMinimum = !uvt || conceptBaseCents < minCents;
  const invoiceLevel = Boolean(common) && isInvoiceLevel(common!.bases.length, common!.bases.length);
  const invoiceValueCents = invoiceLevel && !belowMinimum ? retentionCents(conceptBaseCents, applied.rateBp) : 0;
  // Misma partición que el modelo de la factura (mayor residuo): las partes por línea suman exactamente el valor de la factura.
  const share = invoiceLevel ? (allocate(invoiceValueCents, common!.bases)[common!.index] ?? 0) : undefined;
  return {
    rateId: rate.id,
    name: rate.name,
    baseCents,
    conceptBaseCents,
    minCents,
    rateBp: applied.rateBp,
    appliedFrom: applied.appliedFrom,
    missingUvt: !uvt,
    belowMinimum,
    valueCents: share ?? (belowMinimum ? 0 : retentionCents(baseCents, applied.rateBp)),
    invoiceLevel,
    invoiceValueCents,
  };
}

export const hasRetention = (picks: readonly RetentionPick[], rateId: number) => picks.some((p) => p.rateId === rateId);

/** Agrega un concepto sin repetirlo. */
export const addRetention = (picks: readonly RetentionPick[], rateId: number): RetentionPick[] => (hasRetention(picks, rateId) ? [...picks] : [...picks, { rateId }]);

export const removeRetention = (picks: readonly RetentionPick[], rateId: number): RetentionPick[] => picks.filter((p) => p.rateId !== rateId);

/** Orden de los grupos del selector desplegable. */
export const RETENTION_GROUP_ORDER: RetentionType[] = ["purchases", "services", "fees", "rentals"];

export interface RetentionOption {
  rate: WithholdingRate;
  /** Tarifa vigente en la fecha de la factura. */
  rateBp: number;
  /** Cuantía mínima (UVT de la fecha × base vigente); 0 si no tiene. */
  minCents: number;
  /** Falta el UVT del año: no se puede calcular la cuantía mínima. */
  missingUvt: boolean;
  /** Fecha desde la que rige la tarifa aplicada; sin ella rige la regla base de la tabla. */
  appliedFrom?: string;
}

export interface RetentionGroup {
  type: RetentionType;
  label: string;
  options: RetentionOption[];
}

/** Sin mayúsculas, tildes ni espacios; la coma decimal vale como punto («3,5» = «3.5»). */
const compact = (value: string) => normalizeKey(value).replace(/\s+/g, "").replace(/,/g, ".");

/**
 * Opciones del selector desplegable, agrupadas por tipo (Compras, Servicios, Honorarios, Arrendamientos). Sin texto devuelve la
 * Tabla de retenciones completa; con texto filtra por nombre, tipo o porcentaje. Nunca ofrece un concepto ya elegido. Cada opción
 * trae la tarifa, la cuantía mínima y la vigencia que aplican en la fecha de la factura.
 */
export function retentionOptions(rates: readonly WithholdingRate[], picks: readonly RetentionPick[], versions: readonly RateVersion[], date: string | null | undefined, uvts: readonly UvtValue[], query = ""): RetentionGroup[] {
  const q = compact(query);
  const year = date ? Number(date.slice(0, 4)) : null;
  const uvt = year === null ? undefined : uvts.find((u) => u.year === year);
  const groups = new Map<RetentionType, RetentionOption[]>();
  const ordered = [...rates].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"));
  for (const rate of ordered) {
    if (hasRetention(picks, rate.id)) continue;
    const applied = rateAt(rate, versions, date);
    const haystack = compact(`${rate.name} ${RETENTION_TYPE_LABEL[rate.retentionType]} ${formatRateBp(applied.rateBp)} ${formatRateBp(applied.rateBp, true)}`);
    if (q && !haystack.includes(q)) continue;
    const option: RetentionOption = { rate, rateBp: applied.rateBp, minCents: uvt ? minBaseCents(applied.baseUvtCenti, uvt.valuePesos) : 0, missingUvt: !uvt && applied.baseUvtCenti > 0, appliedFrom: applied.appliedFrom };
    groups.set(rate.retentionType, [...(groups.get(rate.retentionType) ?? []), option]);
  }
  return RETENTION_GROUP_ORDER.filter((t) => groups.has(t)).map((type) => ({ type, label: RETENTION_TYPE_LABEL[type], options: groups.get(type)! }));
}

/** Desplazamiento con teclado por una lista de `count` opciones: flechas (sin dar la vuelta). */
export function moveActive(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return Math.min(current + 1, count - 1);
  if (key === "ArrowUp") return Math.max(current - 1, 0);
  return current;
}

/** Retenciones elegidas en orden, ignorando las que ya no existen en la tabla (el cálculo de la factura las reporta aparte). */
export function chosenRates(rates: readonly WithholdingRate[], picks: readonly RetentionPick[]): { rate: WithholdingRate | undefined; rateId: number }[] {
  return picks.map((p) => ({ rate: rates.find((r) => r.id === p.rateId), rateId: p.rateId }));
}

export const PROPOSALS_INCLUDE = "Incluye PUC, concepto 1001 y retenciones. Solo aplica a esta factura.";
export const confirmProposalsLabel = (n: number) => `Confirmar ${n} ${n === 1 ? "propuesta completa" : "propuestas completas"} (solo esta factura)`;

/** Líneas de la factura con una propuesta lista para confirmar (PUC y concepto 1001, o 7305 que no lleva concepto). */
export const proposableLines = (lines: readonly LineView[]): LineView[] =>
  lines.filter((l) => !l.confirmed && !l.line.issue && l.proposal.pucCode && (l.proposal.concept1001 || isNotApplicablePuc(l.proposal.pucCode)));

/**
 * «Confirmar N propuestas completas»: confirma de cada línea propuesta su PUC, su concepto 1001 y TODAS sus retenciones.
 * Solo vale para esta factura: `saveRule: false`, nunca crea ni cambia reglas de producto/proveedor.
 */
export function proposalInputs(documentId: number, supplierNit: string, lines: readonly LineView[]): LineClassInput[] {
  return proposableLines(lines).map((l) => {
    const full = normalizeClassification({ pucCode: l.proposal.pucCode, concept1001: l.proposal.concept1001, retention: l.proposal.retention });
    return {
      documentId,
      lineIndex: l.line.index,
      pucCode: full.pucCode,
      concept1001: full.concept1001,
      retention: full.retention.map((r) => ({ rateId: r.rateId })),
      saveRule: false,
      supplierNit,
      productKey: productKey(l.line),
      productLabel: lineLabel(l.line),
    };
  });
}
