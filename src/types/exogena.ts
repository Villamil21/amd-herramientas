/** Información Exógena: tipos que viajan entre la interfaz y los comandos de Rust (`models/exogena.rs`). */

export type FormatStatus = "en_preparacion" | "listo" | "requiere_actualizacion" | "no_aplica";

export const FORMAT_STATUS_LABEL: Record<FormatStatus, string> = {
  en_preparacion: "En preparación",
  listo: "Listo",
  requiere_actualizacion: "Requiere actualización",
  no_aplica: "No aplica",
};

export type RecordOrigin = "empresas" | "estados_financieros" | "manual";

export const RECORD_ORIGIN_LABEL: Record<RecordOrigin, string> = { empresas: "Empresas", estados_financieros: "Estados Financieros", manual: "Manual" };

export interface DocumentTypeEntry {
  code: string;
  description: string;
  isSystem: boolean;
  isActive: boolean;
}

export interface CountryEntry {
  code: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
}

export interface DepartmentEntry {
  code: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
}

export interface MunicipalityEntry {
  deptCode: string;
  code: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
}

export interface ExoCatalogs {
  version: string;
  source: string;
  documentTypes: DocumentTypeEntry[];
  countries: CountryEntry[];
  departments: DepartmentEntry[];
  municipalities: MunicipalityEntry[];
}

export type CatalogKey = "document_types" | "countries" | "departments" | "municipalities";

export interface CatalogEntryInput {
  catalog: CatalogKey;
  code: string;
  /** Departamento del municipio (solo `municipalities`). */
  parentCode?: string;
  name: string;
  isActive: boolean;
}

export interface CatalogAuditEntry {
  id: number;
  catalog: CatalogKey;
  code: string;
  action: "add" | "rename" | "activate" | "deactivate" | "delete";
  oldValue: string;
  newValue: string;
  changedAt: string;
}

export interface FormatStatusRow {
  formatCode: string;
  status: FormatStatus;
  notApplicableReason: string;
  lastSyncedAt: string | null;
  sourceFingerprint: string;
  updatedAt: string;
  recordCount: number;
}

export interface ExoOverview {
  statuses: FormatStatusRow[];
  recordCounts: [string, number][];
  sourceFingerprint: string;
}

/** Datos de un registro: las columnas del formato más lo que ayuda a revisarlo. */
export type RecordData = Record<string, unknown>;

export interface ExoRecord {
  id: number;
  companyId: number;
  year: number;
  formatCode: string;
  sourceKey: string;
  origin: RecordOrigin;
  originRef: string;
  data: RecordData;
  /** Campos corregidos a mano en Exógena: una sincronización no los reemplaza sin confirmación. */
  manualFields: string[];
  manuallyModifiedAt: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncProposal {
  sourceKey: string;
  origin: Exclude<RecordOrigin, "manual">;
  originRef: string;
  data: RecordData;
}

export interface ApplySyncInput {
  companyId: number;
  year: number;
  formatCode: string;
  source: string;
  proposals: SyncProposal[];
  removeMissing: boolean;
  sourceFingerprint?: string | null;
  overwriteManual?: string[];
  summary?: unknown;
}

export interface SyncOutcome {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  conflicts: { sourceKey: string; fields: string[] }[];
  keptManualOrphans: string[];
}

export interface SyncRun {
  id: number;
  formatCode: string;
  source: string;
  ranAt: string;
  summary: Record<string, unknown> | null;
}

export interface ResetOutcome {
  snapshotFile: string;
  removedFiles: number;
  warnings: string[];
}

/** Frase que el usuario debe escribir para reiniciar los datos. */
export const RESET_PHRASE = "REINICIAR DATOS";
