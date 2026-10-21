import { exogenaService } from "../../services/exogenaService";
import { EINVOICE_FORMATS } from "./domain/einvoiceSales";

/**
 * Los documentos o los clientes de Facturación electrónica cambiaron: cualquier 1007, 1005 o 1006 «Listo» de esos años vuelve a
 * «Requiere actualización». Nunca se reescribe un formato listo en silencio.
 */
export async function reopenReadyEinvoiceFormats(companyId: number, years: number[]): Promise<void> {
  for (const year of years) {
    const overview = await exogenaService.overview(companyId, year);
    for (const format of EINVOICE_FORMATS) {
      if (overview.statuses.find((s) => s.formatCode === format)?.status === "listo") await exogenaService.setStatus(companyId, year, format, "requiere_actualizacion");
    }
  }
}
