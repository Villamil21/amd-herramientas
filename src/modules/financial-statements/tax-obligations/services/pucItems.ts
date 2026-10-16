import { pucLabel } from "./effects";
import { TAX_PUC, TAX_PUC_ITEMS, sanctionExpenseKey, sanctionPayableKey, type TaxPucItem, type TaxReturn, type TaxType } from "../types";
import { WH_CONCEPTS, WH_SELF_KEY, WH_STAMP_KEY, WH_VAT_KEY, hasWithholdingDetail, whBreakdownOf, whPucKey } from "../withholding/detail";

const CONCEPT_LABEL = new Map<string, string>([...WH_CONCEPTS.map((c) => [c.key, c.label] as [string, string]), [WH_SELF_KEY, "Autorretenciones"], [WH_VAT_KEY, "Retenciones a título de IVA"], [WH_STAMP_KEY, "Retenciones impuesto timbre nacional"]]);

export const whConceptLabel = (key: string) => CONCEPT_LABEL.get(key) ?? key;

/** Cuentas PUC que se pueden configurar desde un impuesto. Retefuente: un PUC por concepto presente en las declaraciones (PJ + PN en uno solo). */
export function taxPucItems(taxType: TaxType, returns: TaxReturn[]): TaxPucItem[] {
  const own = returns.filter((r) => r.taxType === taxType && r.supersededBy === null);
  const items: TaxPucItem[] = [];
  if (taxType === "withholding") {
    const keys = new Set<string>();
    for (const r of own) for (const row of whBreakdownOf(r)?.rows ?? []) keys.add(row.key);
    const ordered = [...CONCEPT_LABEL.keys()].filter((k) => keys.has(k));
    for (const k of ordered) items.push({ key: whPucKey(k), label: pucLabel(whPucKey(k), CONCEPT_LABEL), group: "Retención en la fuente por concepto" });
    if (own.some((r) => r.payableCents > 0 && !hasWithholdingDetail(r))) items.push({ key: TAX_PUC.withholdingPayable, label: "Retención en la fuente por pagar (declaraciones sin discriminar)", group: "Retención en la fuente por concepto" });
    items.push(
      { key: sanctionExpenseKey("withholding"), label: "Sanciones de Retefuente — gasto", group: "Sanciones" },
      { key: sanctionPayableKey("withholding"), label: "Sanciones de Retefuente — cuenta por pagar", group: "Sanciones" },
    );
  } else {
    const group = taxType === "vat" ? "IVA" : "Renta";
    items.push(...TAX_PUC_ITEMS.filter((i) => i.group === group));
  }
  items.push(...TAX_PUC_ITEMS.filter((i) => i.group === "Pagos de impuestos"));
  return items;
}
