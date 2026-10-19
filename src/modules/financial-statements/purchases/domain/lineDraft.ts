import type { LineClassInput, PurchaseLine, RateVersion, RetentionPick } from "../../../../types/purchases";
import type { UvtValue, WithholdingRate } from "../../../../types/models";
import { minBaseCents, retentionCents } from "../../../taxes/withholding/services/money";
import { normalizeKey } from "../../../../utils/text";
import { rateAt } from "./rateVersions";
import { allocate, isInvoiceLevel } from "./retention";
import { lineLabel } from "./model";
import { normalizeClassification, productKey } from "./classify";

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

/** Conceptos que se pueden añadir: los que aún no están elegidos y coinciden con lo escrito (sin tildes ni mayúsculas). */
export function searchRates(rates: readonly WithholdingRate[], picks: readonly RetentionPick[], query: string, limit = 12): WithholdingRate[] {
  const q = normalizeKey(query);
  return rates.filter((r) => !hasRetention(picks, r.id) && (!q || normalizeKey(r.name).includes(q))).slice(0, limit);
}

/** Retenciones elegidas en orden, ignorando las que ya no existen en la tabla (el cálculo de la factura las reporta aparte). */
export function chosenRates(rates: readonly WithholdingRate[], picks: readonly RetentionPick[]): { rate: WithholdingRate | undefined; rateId: number }[] {
  return picks.map((p) => ({ rate: rates.find((r) => r.id === p.rateId), rateId: p.rateId }));
}

export const COPY_ALL_INCLUDES = "Incluye: PUC, concepto 1001 y retenciones.";
export const copyAllLabel = (others: number) => `Aplicar clasificación completa a ${others === 1 ? "la otra línea" : `las otras ${others} líneas`}`;

export interface ClassificationDraft {
  pucCode: string;
  concept1001: string;
  retention: readonly RetentionPick[];
}

/**
 * «Aplicar clasificación completa a las otras líneas»: copia PUC, concepto 1001 y TODAS las retenciones a las líneas elegidas,
 * solo para esta factura (`saveRule: false`). Nunca crea ni cambia reglas de producto: la regla de la línea de origen se guarda
 * únicamente si el usuario lo eligió para esa línea.
 */
export function copyClassificationInputs(
  documentId: number,
  supplierNit: string,
  source: ClassificationDraft,
  targets: readonly PurchaseLine[],
): LineClassInput[] {
  const full = normalizeClassification({ pucCode: source.pucCode, concept1001: source.concept1001, retention: source.retention.map((r) => ({ rateId: r.rateId })) });
  return targets.map((t) => ({
    documentId,
    lineIndex: t.index,
    pucCode: full.pucCode,
    concept1001: full.concept1001,
    retention: full.retention.map((r) => ({ rateId: r.rateId })),
    saveRule: false,
    supplierNit,
    productKey: productKey(t),
    productLabel: lineLabel(t),
  }));
}
