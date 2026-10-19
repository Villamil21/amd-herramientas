import type { LineClassInput, RateVersion, RetentionPick } from "../../../../types/purchases";
import type { UvtValue, WithholdingRate } from "../../../../types/models";
import { minBaseCents, retentionCents } from "../../../taxes/withholding/services/money";
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

/** Conceptos que se pueden añadir: los que aún no están elegidos y coinciden con lo escrito (sin tildes ni mayúsculas). */
export function searchRates(rates: readonly WithholdingRate[], picks: readonly RetentionPick[], query: string, limit = 12): WithholdingRate[] {
  const q = normalizeKey(query);
  return rates.filter((r) => !hasRetention(picks, r.id) && (!q || normalizeKey(r.name).includes(q))).slice(0, limit);
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
