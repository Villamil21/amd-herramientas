import type { BaseMode, PersonType, RetentionType, TitleCategory } from "../../../types/models";

/** Tabla «Detalles de Productos» completa, sin las columnas IVA, IVA %, INC e INC %. */
export interface ProductTable {
  columns: string[];
  rows: { page: number; cells: string[] }[];
}

/** Datos de una factura o nota leídos del PDF. Valores en centavos. */
export interface ParsedDocument {
  pageCount: number;
  /** Título tal como aparece (ej. «FACTURA ELECTRÓNICA DE VENTA»). */
  title: string;
  number?: string;
  /** Fecha de emisión en formato AAAA-MM-DD. */
  issueDate?: string;
  /** Solo dígitos, sin dígito de verificación. */
  supplierNit: string;
  supplierName: string;
  /** «Tipo de Contribuyente» del emisor (ej. «Persona Jurídica»). */
  taxpayerType?: string;
  /** Campos de régimen / responsabilidad del emisor, como texto para mostrar. */
  fiscalText?: string;
  /** Códigos tributarios del emisor (R-99-PN, O-13, O-15…), sin repetir y ordenados. */
  fiscalCodes: string[];
  subtotalCents?: number;
  /** «Rete fuente» de Datos Totales → Retenciones (Rete IVA y Rete ICA se ignoran). */
  retefuenteCents?: number;
  products: ProductTable;
}

export type FileResult =
  | { fileName: string; kind: "parsed"; doc: ParsedDocument }
  | { fileName: string; kind: "incompatible"; message: string }
  | { fileName: string; kind: "error"; message: string };

export type DocStatus =
  | "validated"
  | "ignored-regime"
  | "out-of-period"
  | "duplicate"
  | "below-minimum"
  | "pending-supplier"
  | "pending-base"
  | "pending-title"
  | "pending-period"
  | "difference"
  | "review"
  | "incompatible"
  | "error";

/** Decisiones del usuario para un documento en este análisis (no se guardan en la base). */
export interface DocDecision {
  /** «Cambiar para esta factura»: regla (id de la tabla de retenciones) a aplicar. */
  rateId?: number;
  /** Base de retención para reglas con base diferente / manual. */
  manualBaseCents?: number;
  /** Respuesta a «¿La base y tarifa detectadas son correctas?». */
  review?: { kind: "accept-informed" } | { kind: "corrected"; baseCents: number; rateBp: number };
}

export interface AppliedRule {
  rateId: number;
  retentionType: RetentionType;
  subtypeName: string;
  baseMode: BaseMode;
}

export interface DocRow {
  fileName: string;
  status: DocStatus;
  /** Participa en los totales de la declaración (válido y genera retención). */
  counts: boolean;
  issues: string[];
  notes: string[];
  category?: TitleCategory;
  title?: string;
  titleKey?: string;
  number?: string;
  issueDate?: string;
  periodKey?: string;
  nit?: string;
  supplierName?: string;
  supplierId?: number;
  taxpayerType?: string;
  personType?: PersonType;
  fiscalText?: string;
  fiscalCodes: string[];
  /** O-15 / O-47 que excluyó el documento. */
  excludedCode?: string;
  rule?: AppliedRule;
  /** Reglas del proveedor disponibles para «Cambiar para esta factura». */
  ruleOptions: AppliedRule[];
  uvtYear?: number;
  uvtPesos?: number;
  baseUvtCenti?: number;
  minBaseCents?: number;
  subtotalCents?: number;
  baseCents?: number;
  rateBp?: number;
  calculatedCents?: number;
  /** Rete fuente del PDF. */
  informedCents?: number;
  /** Tarifa implícita del PDF en centésimas de punto (Rete fuente / Subtotal). */
  impliedRateBp?: number;
  comparison?: "match" | "difference" | "none";
  /** Base y retención que van a la declaración (solo si counts). */
  retentionCents: number;
  duplicateOf?: string;
  pageCount?: number;
  products?: ProductTable;
}

export interface PendingSupplier {
  nit: string;
  name: string;
  taxpayerType?: string;
  fiscalText?: string;
  fiscalRegime?: string;
  documentCount: number;
  /** Proveedor ya registrado (desde IVA) al que le falta la configuración de retención. */
  supplierId?: number;
  missing: string[];
}

export interface FiscalChange {
  supplierId: number;
  nit: string;
  name: string;
  stored: string;
  detected: string;
  files: string[];
}

export interface FiscalConflict {
  nit: string;
  name: string;
  variants: { regime: string; files: string[] }[];
}

export interface UnknownTitle {
  normalizedTitle: string;
  displayTitle: string;
  documentCount: number;
}

export interface MonthCount {
  key: string;
  label: string;
  count: number;
}

export interface SummaryCell {
  baseCents: number;
  retentionCents: number;
}

export interface SummaryLine {
  retentionType: RetentionType;
  pj: SummaryCell;
  pn: SummaryCell;
}

export interface SubtypeDetail {
  category: TitleCategory;
  retentionType: RetentionType;
  subtypeName: string;
  personType: PersonType;
  rateBp: number;
  baseCents: number;
  retentionCents: number;
  documentCount: number;
}

export interface WithholdingReport {
  rows: DocRow[];
  period: {
    /** Periodo elegido (AAAA-MM) o undefined si hay empate sin decidir. */
    key?: string;
    label?: string;
    months: MonthCount[];
    /** Meses empatados cuando hay que preguntar. */
    tie: MonthCount[];
  };
  stats: {
    files: number;
    processed: number;
    ignored: number;
    outOfPeriod: number;
    duplicates: number;
    belowMinimum: number;
    validated: number;
    pending: number;
    failed: number;
  };
  pendingSuppliers: PendingSupplier[];
  fiscalChanges: FiscalChange[];
  /** Proveedores sin régimen guardado cuya factura sí lo trae (actualización automática ofrecida). */
  fiscalMissing: { supplierId: number; nit: string; name: string; detected: string }[];
  fiscalConflicts: FiscalConflict[];
  unknownTitles: UnknownTitle[];
  /** Resumen para la declaración: solo Facturas válidas que generaron retención. */
  summary: SummaryLine[];
  detail: SubtypeDetail[];
  totals: { invoicesCents: number; notesCents: number; netCents: number; netRoundedCents: number };
  /** UVT usados (año → valor) para el registro de auditoría. */
  uvtUsed: { year: number; valuePesos: number }[];
}
