import type { RateVersion, RetentionPick } from "../../../../types/purchases";
import type { UvtValue, WithholdingRate } from "../../../../types/models";
import { minBaseCents, retentionCents } from "../../../taxes/withholding/services/money";
import { normalizeKey } from "../../../../utils/text";
import { rateAt } from "./rateVersions";

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
  /** Retención de esta línea con la tarifa vigente en la fecha de la factura (0 si no supera el mínimo). */
  valueCents: number;
}

/** Qué retiene un concepto sobre una línea, con la tarifa, la cuantía mínima y el UVT vigentes en la fecha de la factura. */
export function previewRetention(rate: WithholdingRate, versions: readonly RateVersion[], date: string | null | undefined, uvts: readonly UvtValue[], baseCents: number, conceptBaseCents = baseCents): RetentionPreview {
  const applied = rateAt(rate, versions, date);
  const year = date ? Number(date.slice(0, 4)) : null;
  const uvt = year === null ? undefined : uvts.find((u) => u.year === year);
  const minCents = uvt ? minBaseCents(applied.baseUvtCenti, uvt.valuePesos) : 0;
  const belowMinimum = !uvt || conceptBaseCents < minCents;
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
    valueCents: belowMinimum ? 0 : retentionCents(baseCents, applied.rateBp),
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
