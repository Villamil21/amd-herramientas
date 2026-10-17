import { exogenaService } from "../../../services/exogenaService";
import type { SyncOutcome, SyncProposal } from "../../../types/exogena";
import type { CryptoModel } from "./domain/model";

export type CryptoExoFormat = "1007" | "1647";

export const CRYPTO_EXO_SOURCE = "Estados Financieros";

/** Registros que Transacciones Cripto propone a un formato de Exógena, con la traza hasta las filas del Excel en `originRef`. */
export function proposalsFor(model: CryptoModel, format: CryptoExoFormat): SyncProposal[] {
  const records = format === "1007" ? model.form1007.records : model.form1647.records;
  return records.map((r) => ({ sourceKey: r.sourceKey, origin: "estados_financieros" as const, originRef: r.originRef, data: r.data }));
}

/** Aplica la propuesta (reemplaza lo que ya no se propone, conserva las correcciones manuales salvo las indicadas). */
export function syncCryptoFormat(args: { companyId: number; year: number; model: CryptoModel; format: CryptoExoFormat; overwriteManual?: string[] }): Promise<SyncOutcome> {
  const { companyId, year, model, format, overwriteManual } = args;
  return exogenaService.applySync({
    companyId,
    year,
    formatCode: format,
    source: CRYPTO_EXO_SOURCE,
    proposals: proposalsFor(model, format),
    removeMissing: true,
    overwriteManual,
    summary: { sources: ["Transacciones Cripto · Reporte de operaciones"], files: model.counts.files, operations: model.counts.accepted },
  });
}
