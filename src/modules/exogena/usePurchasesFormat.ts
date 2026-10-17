import { useEffect, useMemo } from "react";
import { usePurchasesData } from "../financial-statements/purchases/usePurchasesData";
import { usePurchasesSelection } from "../financial-statements/purchases/selection";
import { PURCHASES_FORMATS, purchasesFormatState, type PurchasesExoFormat, type PurchasesFormatState } from "./domain/purchasesFormat";
import { nitDigits } from "./domain/text";
import { useCompanies, useFormatRecords } from "./hooks";

/**
 * 1001, 1005 y 1006 de una empresa y un año: los registros guardados en Exógena y lo que Compras, costos y exógena propone hoy
 * desde sus facturas (solo lectura: Exógena no cambia las facturas). El NIT comprador sale de la empresa elegida en Exógena; la
 * selección de Compras sigue a la de Exógena para que «Resolver» abra la misma empresa y año.
 */
export function usePurchasesExo(companyId: number | null, year: number) {
  const { companies } = useCompanies();
  const company = useMemo(() => companies?.find((c) => c.id === companyId) ?? null, [companies, companyId]);
  const buyerNit = company ? nitDigits(company.nit) : null;

  const [, selectPurchases] = usePurchasesSelection();
  useEffect(() => {
    // Sin empresa elegida en Exógena no se pisa la selección que ya tenía Compras.
    if (buyerNit) selectPurchases({ buyerNit, year });
  }, [buyerNit, year, selectPurchases]);

  const data = usePurchasesData({ buyerNit, year });
  const f1001 = useFormatRecords(companyId, year, "1001");
  const f1005 = useFormatRecords(companyId, year, "1005");
  const f1006 = useFormatRecords(companyId, year, "1006");
  const formats = useMemo(() => ({ "1001": f1001, "1005": f1005, "1006": f1006 }), [f1001, f1005, f1006]);

  const model = data.model;
  const computed = useMemo(() => {
    if (!model || !f1001.records || !f1005.records || !f1006.records) return null;
    return Object.fromEntries(PURCHASES_FORMATS.map((f) => [f, purchasesFormatState(model, f, formats[f].records!)])) as Record<PurchasesExoFormat, PurchasesFormatState>;
  }, [model, formats, f1001.records, f1005.records, f1006.records]);

  return { data, company, companies, model, formats, computed, ready: !!(model && computed) };
}

/** Un solo formato (las pantallas 1001, 1005 y 1006). */
export function usePurchasesFormat(companyId: number | null, year: number, format: PurchasesExoFormat) {
  const all = usePurchasesExo(companyId, year);
  return { ...all, format: all.formats[format], state: all.computed?.[format] ?? null };
}
