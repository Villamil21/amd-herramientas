import { useEffect } from "react";
import { exogenaService } from "../../../services/exogenaService";
import { loadEinvoiceContribution } from "../../exogena/useEinvoiceSales";
import { PURCHASES_FORMATS, purchasesFormatState, shouldReopenPurchases } from "../../exogena/domain/purchasesFormat";
import type { PurchasesModel } from "./domain/model";

/**
 * Cada vez que cambia el origen (una factura, una clasificación, una regla, el perfil de IVA…), reabre como «Requiere
 * actualización» el 1001, 1005 o 1006 que estuviera «Listo», aunque Exógena no esté abierto en ese momento.
 */
export function useExoPurchasesGuard(companyId: number | null, model: PurchasesModel | null) {
  useEffect(() => {
    if (companyId === null || !model || model.year === null) return;
    const year = model.year;
    let cancelled = false;
    void (async () => {
      try {
        const overview = await exogenaService.overview(companyId, year);
        for (const format of PURCHASES_FORMATS) {
          const row = overview.statuses.find((s) => s.formatCode === format);
          if (!row || row.status !== "listo") continue;
          const stored = await exogenaService.records(companyId, year, format);
          const sales = format === "1005" || format === "1006" ? await loadEinvoiceContribution(companyId, year) : null;
          if (!cancelled && shouldReopenPurchases(row.status, purchasesFormatState(model, format, stored, undefined, sales).problems)) await exogenaService.setStatus(companyId, year, format, "requiere_actualizacion");
        }
      } catch {
        /* la reapertura se reintenta en el siguiente cambio y la pantalla de Exógena la repite al abrirse */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, model]);
}
