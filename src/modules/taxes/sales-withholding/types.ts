import type { Company, SalesCategory, SelfWithholdingRate } from "../../../types/models";

/** Error esperado de lectura (hoja o columnas faltantes): su mensaje se muestra tal cual. */
export class SalesWithholdingError extends Error {}

/** Impuestos que se restan del Total para obtener la base (en este orden, como en el archivo DIAN). */
export const TAX_COLUMNS = ["IVA", "ICA", "IC", "INC", "Timbre", "INC Bolsas", "IN Carbono", "IN Combustibles", "IC Datos", "ICL", "INPP", "IBUA", "ICUI"] as const;

export type TaxColumn = (typeof TAX_COLUMNS)[number];

export interface InvalidCell {
  column: string;
  text: string;
}

/**
 * Fila de la hoja Ventas. Los importes van en millonésimas de peso (bigint):
 * exactos para cualquier valor que traiga el archivo, sin redondear antes de sumar.
 */
export interface SalesRow {
  /** Fila en Excel (1 = primera). */
  rowNumber: number;
  documentType: string;
  /** normalizeKey del tipo de documento. */
  typeKey: string;
  cufe: string;
  folio: string;
  prefix: string;
  issueDate: string;
  /** NIT Emisor tal como viene. */
  nitText: string;
  /** NIT Emisor normalizado (solo dígitos, sin DV). */
  nit: string;
  issuerName: string;
  /** null = valor no numérico (ver `invalid`). */
  total: bigint | null;
  taxes: Record<TaxColumn, bigint | null>;
  invalid: InvalidCell[];
  /** Suma de IVA…ICUI y base = Total − impuestos. null si la fila tiene valores inválidos. */
  taxesSum: bigint | null;
  base: bigint | null;
}

export interface ParsedSalesFile {
  fileName: string;
  sheetName: string;
  ignoredSheets: string[];
  rows: SalesRow[];
}

export type ReadResult = { kind: "ok"; file: ParsedSalesFile } | { kind: "choose-sheet"; candidates: { name: string; rows: number }[] };

export type RowStatus = "ok" | "invalid" | "no_type" | "unclassified" | "duplicate";

export interface AnalyzedRow extends SalesRow {
  category?: SalesCategory;
  status: RowStatus;
  /** Fila Excel de la primera aparición del mismo documento. */
  duplicateOf?: number;
  /** Suma en el total de su categoría. */
  counted: boolean;
}

export interface CategorySummary {
  count: number;
  /** Millonésimas de peso. */
  base: bigint;
  /** Autorretención en centavos (solo si hay tarifa). */
  withholdingCents?: number;
}

export type PendingKind =
  | "multiple_nits"
  | "no_nit"
  | "company_missing"
  | "ciiu_missing"
  | "ciiu_not_found"
  | "new_type"
  | "no_type"
  | "invalid_value"
  | "duplicate"
  | "same_folio";

export interface Pending {
  kind: PendingKind;
  /** Bloqueante: impide el cálculo o la exportación. */
  blocking: boolean;
  title: string;
  detail?: string;
  items?: string[];
}

export interface IssuerNit {
  nit: string;
  name: string;
  rows: number;
}

export interface SalesAnalysis {
  rows: AnalyzedRow[];
  nits: IssuerNit[];
  /** Único NIT Emisor del archivo (si hay exactamente uno). */
  issuer?: IssuerNit;
  company?: Company;
  /** Tarifa encontrada para el CIIU de la empresa. */
  rate?: SelfWithholdingRate;
  invoices: CategorySummary;
  creditNotes: CategorySummary;
  /** Solo con tarifa: Autorretención neta = Facturas − Notas Crédito, en centavos. */
  totals?: { netCents: number; netRoundedCents: number };
  /** Tipos de documento sin clasificación guardada. */
  newTypes: { key: string; label: string; rows: number }[];
  pending: Pending[];
  /** Sin pendientes bloqueantes: el cierre se puede presentar y exportar. */
  complete: boolean;
}
