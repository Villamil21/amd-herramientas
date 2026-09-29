import type { VatType } from "../../../types/models";

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

export type InvoiceStatus = "processed" | "pending-supplier" | "review" | "incompatible" | "error";

export interface BaseVat {
  baseCents: number;
  vatCents: number;
}

export interface InvoiceRow {
  fileName: string;
  status: InvoiceStatus;
  documentType?: string;
  documentTypeKey?: string;
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
  /** Motivos de revisión (o el error / incompatibilidad). */
  issues: string[];
  /** Información que no exige revisión (ej. diferencia de redondeo del IVA). */
  notes: string[];
  lineIssues: LineIssue[];
}

export interface PendingSupplier {
  nit: string;
  name: string;
  invoiceCount: number;
}

export interface NameMismatch {
  supplierId: number;
  nit: string;
  vatType: VatType;
  storedName: string;
  invoiceName: string;
  invoiceCount: number;
}

export interface DocumentTypeSummary {
  documentType: string;
  documentTypeKey: string;
  invoiceCount: number;
  /** De bienes gravados a la tarifa del 5 % (Compras, 5 %). */
  purchases5: BaseVat;
  /** De bienes gravados a la tarifa general (Compras, 19 %). */
  purchases19: BaseVat;
  /** De servicios gravados a la tarifa general (Servicios, 19 %). */
  services19: BaseVat;
  /** De bienes y servicios excluidos, exentos y no gravados (0 %, Compras y Servicios). */
  zeroBaseCents: number;
  /** Servicios al 5 %: no tienen renglón en el resumen; se muestran para revisión. */
  services5: BaseVat;
  otherRates: (BaseVat & { rateBp: RateBp })[];
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
    processed: number;
    review: number;
    failed: number;
    pending: number;
    suppliers: number;
    newSuppliers: number;
    documentTypes: number;
    duplicates: number;
  };
  pendingSuppliers: PendingSupplier[];
  nameMismatches: NameMismatch[];
  /** Vacío mientras haya proveedores pendientes. */
  summaries: DocumentTypeSummary[];
  incidents: Incident[];
}
