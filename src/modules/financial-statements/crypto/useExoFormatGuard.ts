import { useEffect } from "react";
import { cryptoFormatState, CRYPTO_FORMATS, shouldReopen } from "../../exogena/domain/cryptoFormat";
import { exogenaService } from "../../../services/exogenaService";
import { loadEinvoiceContribution } from "../../exogena/useEinvoiceSales";
import type { CryptoModel } from "./domain/model";

/**
 * Cada vez que cambia el origen (una carga, un duplicado, una asignación, una ciudad, el corte…), reabre como «Requiere
 * actualización» el 1007 o el 1647 que estuviera «Listo», aunque Exógena no esté abierto en ese momento.
 */
export function useExoFormatGuard(companyId: number | null, model: CryptoModel | null) {
  useEffect(() => {
    if (companyId === null || !model) return;
    let cancelled = false;
    void (async () => {
      try {
        const overview = await exogenaService.overview(companyId, model.year);
        for (const format of CRYPTO_FORMATS) {
          const row = overview.statuses.find((s) => s.formatCode === format);
          if (!row || row.status !== "listo") continue;
          const stored = await exogenaService.records(companyId, model.year, format);
          const sales = format === "1007" ? await loadEinvoiceContribution(companyId, model.year) : null;
          if (!cancelled && shouldReopen(row.status, cryptoFormatState(model, format, stored, sales).problems)) await exogenaService.setStatus(companyId, model.year, format, "requiere_actualizacion");
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
