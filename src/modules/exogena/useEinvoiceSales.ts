import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../components/ui";
import { einvoiceService } from "../../services/einvoiceService";
import { purchasesService } from "../../services/purchasesService";
import { errorMessage } from "../../services/tauri";
import type { EinvoiceCustomer, EinvoiceDoc } from "../../types/einvoice";
import type { CompanyVatEntry } from "../../types/purchases";
import { buildEinvoiceContribution, type EinvoiceContribution } from "./domain/einvoiceSales";

/** Lee de SQLite lo que necesita la contribución de ventas y la calcula (para sincronizaciones y reaperturas fuera de pantalla). */
export async function loadEinvoiceContribution(companyId: number, year: number): Promise<EinvoiceContribution> {
  const [docs, customers, companyVat] = await Promise.all([einvoiceService.docs(companyId, year), einvoiceService.customers(companyId), purchasesService.companyVatHistory(companyId)]);
  return buildEinvoiceContribution({ docs, customers, companyVat, year });
}

/**
 * Ventas por facturación electrónica de una empresa y un año para 1007, 1005 y 1006: documentos guardados, clientes confirmados y
 * lo que de ahí se propone. Se recalcula siempre desde lo guardado.
 */
export function useEinvoiceSales(companyId: number | null, year: number) {
  const toast = useToast();
  const [data, setData] = useState<{ docs: EinvoiceDoc[]; customers: EinvoiceCustomer[]; companyVat: CompanyVatEntry[] } | null>(null);
  const reload = useCallback(async () => {
    if (companyId === null) return setData(null);
    try {
      const [docs, customers, companyVat] = await Promise.all([einvoiceService.docs(companyId, year), einvoiceService.customers(companyId), purchasesService.companyVatHistory(companyId)]);
      setData({ docs, customers, companyVat });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, year, toast]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);
  const contribution = useMemo(() => (data ? buildEinvoiceContribution({ ...data, year }) : null), [data, year]);
  return { docs: data?.docs ?? null, customers: data?.customers ?? null, contribution, reload };
}

export type EinvoiceSales = ReturnType<typeof useEinvoiceSales>;
