import { exogenaService } from "../../../services/exogenaService";
import { loadEinvoiceContribution } from "../../exogena/useEinvoiceSales";
import { loadBankExoContribution } from "../bank/exogena/load";
import type { SyncOutcome, SyncProposal } from "../../../types/exogena";
import type { CryptoModel } from "./domain/model";

export type CryptoExoFormat = "1007" | "1647";

export const CRYPTO_EXO_SOURCE = "Estados Financieros";

/** Registros que Transacciones Cripto propone a un formato de Exógena, con la traza hasta las filas del Excel en `originRef`. */
export function proposalsFor(model: CryptoModel, format: CryptoExoFormat): SyncProposal[] {
  const records = format === "1007" ? model.form1007.records : model.form1647.records;
  return records.map((r) => ({ sourceKey: r.sourceKey, origin: "estados_financieros" as const, originRef: r.originRef, data: r.data }));
}

/**
 * Aplica la propuesta (reemplaza lo que ya no se propone, conserva las correcciones manuales salvo las indicadas). El 1007 incluye
 * siempre lo que proponen Facturación electrónica y Extractos bancarios: si no, «retirar lo que ya no se propone» borraría esos registros.
 */
export async function syncCryptoFormat(args: { companyId: number; year: number; model: CryptoModel; format: CryptoExoFormat; overwriteManual?: string[] }): Promise<SyncOutcome> {
  const { companyId, year, model, format, overwriteManual } = args;
  const sales = format === "1007" ? await loadEinvoiceContribution(companyId, year) : null;
  const bank = format === "1007" ? await loadBankExoContribution(companyId, year) : null;
  return exogenaService.applySync({
    companyId,
    year,
    formatCode: format,
    source: CRYPTO_EXO_SOURCE,
    proposals: [...proposalsFor(model, format), ...(sales?.proposals["1007"] ?? []), ...(bank?.proposals["1007"] ?? [])],
    removeMissing: true,
    overwriteManual,
    summary: {
      sources: ["Transacciones Cripto · Reporte de operaciones", ...(sales ? ["Facturación electrónica"] : []), ...(bank ? ["Extractos bancarios"] : [])],
      files: model.counts.files,
      operations: model.counts.accepted,
      ...(sales ? { einvoiceDocuments: sales.documents } : {}),
      ...(bank ? { bankInterestRecords: bank.proposals["1007"].length } : {}),
    },
  });
}
