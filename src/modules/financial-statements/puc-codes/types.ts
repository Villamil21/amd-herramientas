import type { TitleCategory } from "../../../types/models";

/** Fila de «Detalles de Productos»: solo lo que usa este módulo. Valores en centavos. */
export interface PucProduct {
  page: number;
  /** Número de la fila dentro de la tabla (1, 2, 3…), en el orden del PDF. */
  row: number;
  description: string;
  /** Columna «Precio unitario de venta». Sin definir si no se pudo leer (no se inventa). */
  priceCents?: number;
  /** Motivo por el que la fila requiere revisión: no se leyó la descripción o el precio. */
  issue?: string;
  /** Texto de la fila tal como se detectó en el PDF (solo en filas con `issue`). */
  detectedText?: string;
}

export interface ParsedPucDocument {
  pageCount: number;
  /** Título tal como aparece (ej. «FACTURA ELECTRÓNICA DE VENTA»). */
  title: string;
  number?: string;
  /** CUFE o CUDE, en minúsculas. */
  cufe?: string;
  /** AAAA-MM-DD. */
  issueDate?: string;
  /** Solo dígitos, sin dígito de verificación. */
  issuerNit: string;
  issuerName: string;
  products: PucProduct[];
  /** Datos Totales → «Total Bruto Factura». */
  grossTotalCents?: number;
}

/** Resultado de leer un archivo de la carpeta. */
export type FileResult =
  | { fileName: string; kind: "parsed"; doc: ParsedPucDocument }
  | { fileName: string; kind: "incompatible"; message: string }
  | { fileName: string; kind: "error"; message: string };

/** Los dos tipos finales de documento: Factura electrónica (suma) o Nota crédito (resta). */
export type DocCategory = TitleCategory;

export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = { invoice: "Factura electrónica", credit_note: "Nota crédito" };

/** Título normalizado → categoría (la clasificación guardada en SQLite). */
export interface TitleRule {
  normalizedTitle: string;
  category: DocCategory;
}

/** document: un solo código para toda la factura. product: un código por producto. */
export type AssignmentMode = "document" | "product";

/**
 * Lo que el usuario decidió para un documento del lote. Vive en la sesión de
 * análisis: no se guarda en el PDF ni crea reglas «descripción → código».
 */
export interface DocAssignment {
  mode?: AssignmentMode;
  /** Modo «document»: el código de toda la factura. */
  documentCode?: string;
  /** Modo «product»: código por índice de la fila en `products`. */
  lineCodes?: Record<number, string>;
  /** Documento fuera del análisis (no suma ni bloquea la exportación). */
  excluded?: boolean;
  /** Coincide con otro por NIT + número, pero el usuario indicó que no es el mismo documento. */
  includeDuplicate?: boolean;
}

export type Assignments = Record<string, DocAssignment>;

/** Pendiente: sin códigos. Parcial: algunos productos sin código. Clasificada: todas sus líneas con código válido. */
export type Classification = "pending" | "partial" | "classified";

export const CLASSIFICATION_LABEL: Record<Classification, string> = { pending: "Pendiente", partial: "Parcial", classified: "Clasificada" };

export type ProblemCode =
  | "title-missing"
  | "duplicate"
  | "no-mode"
  | "no-code"
  | "invalid-code"
  | "gross-missing"
  | "no-products"
  | "lines-unread"
  | "lines-without-code";

/** Motivo que impide dar por terminado un documento (bloquea la exportación). */
export interface RowProblem {
  code: ProblemCode;
  text: string;
}

/** Línea de producto con su asignación. */
export interface DocLine extends PucProduct {
  /** Índice en `products` (clave de `lineCodes`). */
  index: number;
  /** Código asignado (el de la factura en modo «document»). */
  code?: string;
  /** Concepto del código según la tabla PUC; sin definir si el código no es válido. */
  concept?: string;
}

/** Valor que un documento aporta a un código, ya con signo (Nota crédito en negativo). */
export interface Allocation {
  code: string;
  concept: string;
  valueCents: number;
}

export interface DocRow {
  fileName: string;
  /** El archivo no se pudo leer o no es una factura compatible: el motivo. */
  failure?: { kind: "incompatible" | "error"; message: string };
  excluded: boolean;
  classification: Classification;
  title?: string;
  titleKey?: string;
  /** Sin definir mientras el título no esté clasificado. */
  category?: DocCategory;
  number?: string;
  cufe?: string;
  issueDate?: string;
  issuerNit?: string;
  issuerName?: string;
  pageCount?: number;
  grossTotalCents?: number;
  mode?: AssignmentMode;
  documentCode?: string;
  documentConcept?: string;
  lines: DocLine[];
  /** Líneas con un código válido. */
  classifiedLines: number;
  /** Archivo del lote que ya trae el mismo documento. */
  duplicateOf?: string;
  /** cufe: mismo CUFE / CUDE (es el mismo documento). number: mismo NIT emisor + número. */
  duplicateBy?: "cufe" | "number";
  /** Problemas sin resolver. */
  problems: RowProblem[];
  /** Lo que suma en el resumen (vacío mientras algo impida calcularlo). */
  allocations: Allocation[];
  /** Total que el documento aporta al resumen. */
  assignedCents: number;
}

/** Título de documento que aún no está clasificado como Factura electrónica o Nota crédito. */
export interface UnknownTitle {
  normalizedTitle: string;
  displayTitle: string;
  documentCount: number;
}

/** Resumen final: un renglón por código PUC. */
export interface CodeSummaryRow {
  code: string;
  concept: string;
  invoicesCents: number;
  /** En negativo. */
  notesCents: number;
  netCents: number;
}

/** Resumen por documento: un renglón por cada código que usa. */
export interface DocumentSummaryRow extends Allocation {
  fileName: string;
  number?: string;
  issuerName?: string;
  category: DocCategory;
}

/** Fila de producto que el lector no pudo interpretar. */
export interface ExtractionIssue {
  fileName: string;
  page: number;
  row: number;
  detectedText: string;
  reason: string;
}

export interface PucReport {
  rows: DocRow[];
  unknownTitles: UnknownTitle[];
  summary: CodeSummaryRow[];
  totals: Omit<CodeSummaryRow, "code" | "concept">;
  byDocument: DocumentSummaryRow[];
  extractionIssues: ExtractionIssue[];
  stats: {
    files: number;
    pending: number;
    partial: number;
    classified: number;
    invoices: number;
    notes: number;
    excluded: number;
    duplicates: number;
  };
}
