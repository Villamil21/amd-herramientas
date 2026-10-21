import { useEffect, useMemo } from "react";
import { usePurchasesData } from "../financial-statements/purchases/usePurchasesData";
import { usePurchasesSelection } from "../financial-statements/purchases/selection";
import { usePayrollOverview } from "../financial-statements/payroll/social/usePayrollOverview";
import { problemsFromPayrollAlerts } from "./domain/payrollFormat";
import { PURCHASES_FORMATS, purchasesFormatState, type PurchasesExoFormat, type PurchasesFormatState } from "./domain/purchasesFormat";
import { nitDigits } from "./domain/text";
import { useCompanies, useFormatRecords } from "./hooks";
import { useEinvoiceSales } from "./useEinvoiceSales";

/**
 * 1001, 1005 y 1006 de una empresa y un año: los registros guardados en Exógena y lo que Compras, costos y exógena propone hoy
 * desde sus facturas (solo lectura: Exógena no cambia las facturas). 1005 y 1006 suman además las ventas de Facturación electrónica. El 1001 suma además los pagos a entidades de seguridad
 * social de Nómina y seguridad social. El NIT comprador sale de la empresa elegida en Exógena; la
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

  // Nómina y seguridad social aporta al 1001 una fila por entidad + concepto (los demás formatos no la usan).
  const { overview: payroll } = usePayrollOverview(companyId, year);

  // Facturación electrónica aporta ventas al 1005 (notas crédito) y al 1006 (facturas).
  const sales = useEinvoiceSales(companyId, year);

  const model = data.model;
  const salesContribution = sales.contribution;
  const computed = useMemo(() => {
    if (!model || !payroll || !salesContribution || !f1001.records || !f1005.records || !f1006.records) return null;
    const fromPayroll = { proposals: payroll.f1001.proposals, problems: problemsFromPayrollAlerts(payroll.alerts, "1001") };
    return Object.fromEntries(PURCHASES_FORMATS.map((f) => [f, purchasesFormatState(model, f, formats[f].records!, f === "1001" ? fromPayroll : undefined, salesContribution)])) as Record<PurchasesExoFormat, PurchasesFormatState>;
  }, [model, payroll, salesContribution, formats, f1001.records, f1005.records, f1006.records]);

  return { data, company, companies, model, formats, computed, payroll, sales, ready: !!(model && computed) };
}

/** Un solo formato (las pantallas 1001, 1005 y 1006). */
export function usePurchasesFormat(companyId: number | null, year: number, format: PurchasesExoFormat) {
  const all = usePurchasesExo(companyId, year);
  return { ...all, format: all.formats[format], state: all.computed?.[format] ?? null };
}
