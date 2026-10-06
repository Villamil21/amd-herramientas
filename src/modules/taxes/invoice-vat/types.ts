import type { Supplier, TitleCategory, VatType } from "../../../types/models";

/** Tarifa en centésimas de punto: 19 % → 1900, 5 % → 500 (sin decimales binarios). */
export type RateBp = number;

/** Una fila de «Detalles de Productos» ya interpretada. Valores en centavos. */
export interface InvoiceLine {
  page: number;
  description: string;
  rateBp: RateBp;
  /** Columna IVA. */
  vatCents: number;
  /** Columna «Precio unitario de venta» (la base de este análisis). */
  baseCents: number;
}

/**
 * Fila de «Detalles de Productos» para la vista de auditoría, en el orden del
 * PDF. Lleva los mismos valores de `lines`; en una fila que no se pudo
 * interpretar, solo lo que sí se leyó (lo ausente queda sin definir).
 */
export interface ProductLine {
  page: number;
  description: string;
  rateBp?: RateBp;
  vatCents?: number;
  baseCents?: number;
  /** Fila que el lector no pudo interpretar: el motivo. */
  issue?: string;
  /** Las columnas IVA y % están vacías en el PDF (candidata a 0 % si el documento concilia). */
  emptyTax?: boolean;
  /** Cómo se resolvió una fila con `issue` (el PDF no se modifica: es una decisión del análisis). */
  origin?: LineOrigin;
}

/**
 * auto-zero: IVA y % vacíos y el documento concilia sin IVA para la fila → 0 %.
 * manual: el usuario definió la tarifa. ignored: el usuario decidió no sumarla.
 */
export type LineOrigin = "auto-zero" | "manual" | "ignored";

/** Fila de la tabla que no permitió identificar %, IVA o precio unitario de venta. */
export interface LineIssue {
  page: number;
  text: string;
  reason: string;
}

export interface ParsedInvoice {
  pageCount: number;
  /** Título tal como aparece (ej. «FACTURA ELECTRÓNICA DE VENTA»). */
  documentType: string;
  invoiceNumber?: string;
  /** Solo dígitos, sin dígito de verificación. */
  supplierNit: string;
  supplierName: string;
  lines: InvoiceLine[];
  lineIssues: LineIssue[];
  /** Todas las filas de la tabla (interpretadas o no), para «Detalle de productos». */
  products: ProductLine[];
  /** «Subtotal» y «Total Bruto Factura» de Datos Totales, si se encontraron. */
  subtotalCents?: number;
  grossTotalCents?: number;
  /** IVA total del documento (Datos Totales o, en su defecto, el texto del código QR). */
  invoiceVatCents?: number;
}

/** Resultado de leer un archivo de la carpeta. */
export type FileResult =
  | { fileName: string; kind: "parsed"; invoice: ParsedInvoice }
  | { fileName: string; kind: "incompatible"; message: string }
  | { fileName: string; kind: "error"; message: string };

/** Las dos categorías finales del resumen: Factura electrónica (invoice) o Nota crédito (credit_note). */
export type DocCategory = TitleCategory;

export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = { invoice: "Factura electrónica", credit_note: "Nota crédito" };

/** Título normalizado → categoría (la clasificación guardada en SQLite). */
export interface TitleRule {
  normalizedTitle: string;
  category: DocCategory;
}

/** Tarifa que el usuario define para una fila sin interpretar, o no sumarla. */
export type LineChoice = 0 | 500 | 1900 | "ignore";

/** Decisiones del usuario sobre un documento del lote (no se guardan en el PDF ni en la base). */
export interface DocDecision {
  /** Por índice de la fila en «Detalle de productos». */
  lines?: Record<number, LineChoice>;
  /** Acepta la lectura aunque bases o IVA no concilien con los totales del documento. */
  confirmed?: boolean;
  /** Documento fuera del resumen (no bloquea la declaración). */
  excluded?: boolean;
  /** Posible duplicado que el usuario decidió sumar. */
  includeDuplicate?: boolean;
}

export type Decisions = Record<string, DocDecision>;

/**
 * processed: validado, suma en el resumen. pending-title / pending-supplier:
 * falta clasificar el título o el proveedor. review: tiene un problema por
 * resolver. excluded: el usuario lo dejó fuera.
 */
export type InvoiceStatus = "processed" | "pending-supplier" | "pending-title" | "review" | "excluded" | "incompatible" | "error";

export type ProblemCode = "title-missing" | "supplier-name" | "lines" | "no-products" | "other-rate" | "services-5" | "duplicate" | "base-mismatch" | "vat-mismatch";

/** Motivo que impide validar un documento. */
export interface RowProblem {
  code: ProblemCode;
  text: string;
}

export interface BaseVat {
  baseCents: number;
  vatCents: number;
}

export interface InvoiceRow {
  fileName: string;
  status: InvoiceStatus;
  documentType?: string;
  documentTypeKey?: string;
  /** Sin definir mientras el título no esté clasificado. */
  category?: DocCategory;
  invoiceNumber?: string;
  supplierNit?: string;
  supplierName?: string;
  vatType?: VatType;
  pageCount?: number;
  lineCount: number;
  base5: number;
  vat5: number;
  base19: number;
  vat19: number;
  base0: number;
  /** Tarifas distintas de 0 %, 5 % y 19 %: se conservan aparte para revisión. */
  otherRates: (BaseVat & { rateBp: RateBp })[];
  detailVatCents: number;
  invoiceVatCents?: number;
  subtotalCents?: number;
  /** Nombre del archivo que ya tiene el mismo NIT + número de factura. */
  duplicateOf?: string;
  /** Problemas sin resolver (bloquean la declaración). */
  problems: RowProblem[];
  /** Textos de `problems` (o el error / incompatibilidad del archivo). */
  issues: string[];
  /** Información que no exige revisión (ej. diferencia de redondeo del IVA, filas interpretadas como 0 %). */
  notes: string[];
  /** Filas de productos que siguen sin tarifa (índices en `products`). */
  pendingLines: number[];
  /** Todas las filas, con la interpretación final de cada una. */
  products: ProductLine[];
}

export interface PendingSupplier {
  nit: string;
  name: string;
  invoiceCount: number;
  /** Ya está en Proveedores (por ejemplo, creado desde Códigos PUC) pero sin Tipo IVA: se completa, no se crea otro. */
  registered?: Supplier;
}

/** Título de documento que aún no está clasificado como Factura electrónica o Nota crédito. */
export interface UnknownTitle {
  normalizedTitle: string;
  displayTitle: string;
  documentCount: number;
}

export interface NameMismatch {
  supplierId: number;
  nit: string;
  vatType: VatType | null;
  storedName: string;
  invoiceName: string;
  invoiceCount: number;
}

/** Resumen de las Facturas electrónicas validadas. */
export interface InvoiceSummary {
  documentCount: number;
  /** De bienes gravados a la tarifa del 5 % (Compras, 5 %). */
  purchases5: BaseVat;
  /** De bienes gravados a la tarifa general (Compras, 19 %). */
  purchases19: BaseVat;
  /** De servicios gravados a la tarifa general (Servicios, 19 %). */
  services19: BaseVat;
  /** De bienes y servicios excluidos, exentos y no gravados (0 %, Compras y Servicios). */
  zeroBaseCents: number;
}

/** Resumen de las Notas crédito validadas: una sola fila, sin separar tarifas ni tipo de proveedor. */
export interface NotesSummary extends BaseVat {
  documentCount: number;
}

export interface VatSummaryData {
  invoices: InvoiceSummary;
  notes: NotesSummary;
}

export interface Incident {
  fileName: string;
  type: string;
  detail: string;
}

export interface InvoiceReport {
  rows: InvoiceRow[];
  stats: {
    files: number;
    /** Documentos que suman en el resumen. */
    validated: number;
    /** Documentos que requieren intervención. */
    pending: number;
    excluded: number;
    invoices: number;
    notes: number;
    suppliers: number;
    newSuppliers: number;
    duplicates: number;
  };
  pendingSuppliers: PendingSupplier[];
  unknownTitles: UnknownTitle[];
  nameMismatches: NameMismatch[];
  /** Solo documentos validados; es parcial mientras `stats.pending` sea mayor que cero. */
  summary: VatSummaryData;
  incidents: Incident[];
}
