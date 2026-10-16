import type { FormatConcept, FormatConceptInput } from "../types/exogena";
import type { ApplySyncInput, CatalogAuditEntry, CatalogEntryInput, CatalogKey, ExoCatalogs, ExoOverview, ExoRecord, FormatStatus, RecordData, SyncOutcome, SyncRun } from "../types/exogena";
import { call } from "./tauri";

export interface ExogenaWorkbookInput {
  companyName: string;
  companyNit: string;
  year: number;
  sheets: {
    name: string;
    title: string;
    columns: { header: string; kind: "text" | "integer" }[];
    rows: (number | string | null)[][];
  }[];
}

/** Información Exógena: catálogos, estado por formato y registros (el cálculo de cada formato vive en `modules/exogena`). */
export const exogenaService = {
  catalogs: () => call<ExoCatalogs>("get_exo_catalogs"),
  saveCatalogEntry: (input: CatalogEntryInput) => call<void>("save_exo_catalog_entry", { input }),
  deleteCatalogEntry: (catalog: CatalogKey, code: string, parentCode?: string) => call<void>("delete_exo_catalog_entry", { catalog, code, parentCode: parentCode ?? null }),
  catalogAudit: (limit = 200) => call<CatalogAuditEntry[]>("list_exo_catalog_audit", { limit }),

  formatConcepts: (formatCode: string) => call<FormatConcept[]>("list_exo_format_concepts", { formatCode }),
  saveFormatConcept: (input: FormatConceptInput) => call<void>("save_exo_format_concept", { input }),
  deleteFormatConcept: (formatCode: string, code: string) => call<void>("delete_exo_format_concept", { formatCode, code }),

  overview: (companyId: number, year: number) => call<ExoOverview>("get_exo_overview", { companyId, year }),
  setStatus: (companyId: number, year: number, formatCode: string, status: FormatStatus, reason?: string) =>
    call<void>("set_exo_format_status", { companyId, year, formatCode, status, reason: reason ?? null }),
  records: (companyId: number, year: number, formatCode: string) => call<ExoRecord[]>("list_exo_records", { companyId, year, formatCode }),
  applySync: (input: ApplySyncInput) => call<SyncOutcome>("apply_exo_sync", { input }),
  updateRecord: (id: number, patch: RecordData) => call<ExoRecord>("update_exo_record", { id, patch }),
  createRecord: (companyId: number, year: number, formatCode: string, data: RecordData) => call<ExoRecord>("create_exo_record", { companyId, year, formatCode, data }),
  deleteRecord: (id: number) => call<void>("delete_exo_record", { id }),
  syncRuns: (companyId: number, year: number, limit = 20) => call<SyncRun[]>("list_exo_sync_runs", { companyId, year, limit }),
  /** Guarda el libro donde elija el usuario; devuelve la ruta o `null` si canceló. */
  saveWorkbook: (companyId: number, workbook: ExogenaWorkbookInput, suggestedName: string) => call<string | null>("save_exogena_workbook", { companyId, workbook, suggestedName }),
};
