import type { RateVersion } from "../../../../types/purchases";
import type { WithholdingRate } from "../../../../types/models";

/**
 * PUNTO ÚNICO de resolución de la Tabla de retenciones con vigencia por fecha: lo usan Retefuente (Impuestos) y Compras, costos y
 * exógena, de modo que un concepto nunca se calcula distinto según el módulo.
 *
 * Tabla de retenciones con vigencia por fecha. La fila de la tabla es la regla base (rige desde el inicio hasta la primera
 * vigencia); cada vigencia rige desde su fecha efectiva hacia adelante. Una factura usa SIEMPRE lo vigente en su propia fecha:
 * cargar una vigencia posterior no recalcula facturas históricas.
 */
export function rateAt(rate: WithholdingRate, versions: readonly RateVersion[], date: string | null | undefined): WithholdingRate & { appliedFrom?: string } {
  if (!date) return rate;
  let found: RateVersion | undefined;
  for (const v of versions) if (v.rateId === rate.id && v.effectiveFrom <= date && (!found || v.effectiveFrom > found.effectiveFrom)) found = v;
  return found ? { ...rate, baseUvtCenti: found.baseUvtCenti, rateBp: found.rateBp, appliedFrom: found.effectiveFrom } : rate;
}

export const ratesAt = (rates: readonly WithholdingRate[], versions: readonly RateVersion[], date: string | null | undefined): WithholdingRate[] =>
  versions.length === 0 ? [...rates] : rates.map((r) => rateAt(r, versions, date));

/** Vigencias de un concepto, de la más antigua a la más reciente. */
export const versionsOf = (versions: readonly RateVersion[], rateId: number) => versions.filter((v) => v.rateId === rateId).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
