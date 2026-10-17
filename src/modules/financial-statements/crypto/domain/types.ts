import { ACCOUNTING_LABEL, type AccountingPresentation } from "../../shared/accountingPresentation";
/**
 * Transacciones Cripto → Reporte de operaciones. Tipos que viajan entre la interfaz y los comandos de Rust
 * (`src-tauri/src/database/crypto.rs`) y los que usa el dominio para calcular.
 */

export type CryptoKind = "purchase" | "sale";
export type CryptoPresentation = AccountingPresentation;

export const PRESENTATION_LABEL = ACCOUNTING_LABEL;

export type CellValue = string | number;
/** Valores originales de una fila de Excel por texto de encabezado (solo las celdas con contenido). */
export type RowData = Record<string, CellValue>;

/** Fila de origen lista para guardar. */
export interface CryptoRowInput {
  kind: CryptoKind;
  sheet: string;
  /** Fila en Excel (1 = encabezado). */
  rowNumber: number;
  /** Huella del contenido: dos filas con la misma huella son materialmente idénticas. */
  fingerprint: string;
  data: RowData;
}

export interface CryptoUpload {
  id: number;
  companyId: number;
  year: number;
  fileName: string;
  version: number;
  status: "active" | "retired";
  sheets: string[];
  /** Meses AAAA-MM que el usuario fijó como cobertura (reemplaza al derivado de Compras.Fecha). */
  coverageOverride: string[] | null;
  importedAt: string;
  updatedAt: string;
  rowCount: number;
}

export interface CryptoStoredRow extends CryptoRowInput {
  id: number;
  uploadId: number;
}

export type DecisionKind = "duplicate" | "row_exclude" | "assignment" | "city" | "country" | "setting";

export interface CryptoDecision {
  kind: DecisionKind;
  key: string;
  value: string;
  fingerprint: string;
  decidedAt: string;
}

export interface CryptoVersion {
  uploadId: number;
  version: number;
  importedAt: string;
  rowsTotal: number;
  summary: Partial<VersionDiffSummary>;
}

export interface CryptoAuditEntry {
  id: number;
  event: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface CryptoState {
  uploads: CryptoUpload[];
  rows: CryptoStoredRow[];
  decisions: CryptoDecision[];
  versions: CryptoVersion[];
  audit: CryptoAuditEntry[];
}

export interface Homologation {
  kind: "document" | "city";
  sourceKey: string;
  value: string;
}

export interface SaveUploadInput {
  companyId: number;
  year: number;
  fileName: string;
  sheets: string[];
  rows: CryptoRowInput[];
  summary: Partial<VersionDiffSummary>;
  replace: boolean;
}

export interface SaveUploadOutcome {
  status: "saved" | "exists";
  uploadId: number;
  version: number;
}

/** Comparación de una carga nueva con la versión vigente del mismo archivo. */
export interface VersionDiffSummary {
  added: number;
  modified: number;
  unchanged: number;
  removed: number;
}
