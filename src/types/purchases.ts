/**
 * Compras, costos y exógena: tipos que viajan entre la interfaz y los comandos de Rust (`database/purchases.rs`).
 * Las facturas se guardan tal como se leyeron (`data`); todo lo calculado se recalcula desde ahí.
 */

/** Una línea de «Detalles de Productos». Valores en centavos; la cantidad en unidades (decimales). */
export interface PurchaseLine {
  /** Posición en el PDF (0 = primera fila). Es la clave de la clasificación de la línea. */
  index: number;
  page: number;
  /** Columna «Código» del PDF (referencia del vendedor), si la trae. */
  code: string;
  description: string;
  unit: string;
  quantity?: number;
  unitPriceCents?: number;
  discountCents?: number;
  surchargeCents?: number;
  /** «Precio unitario de venta»: el importe (base) de la línea. Sin definir si no se pudo leer (no se inventa). */
  baseCents?: number;
  vatCents?: number;
  rateBp?: number;
  /** El lector no interpretó la fila: el motivo. */
  issue?: string;
  detectedText?: string;
}

export interface PurchaseIssuer {
  nit: string;
  name: string;
  /** «Persona Jurídica» → PJ · «Persona Natural» → PN. */
  personType?: "PJ" | "PN";
  address?: string;
  country?: string;
  department?: string;
  city?: string;
  phone?: string;
  email?: string;
  /** Códigos tributarios del emisor (O-13, O-15, O-47, R-99-PN…). */
  fiscalCodes: string[];
  fiscalText?: string;
  /** «Tipo de Documento» tal como lo escribe la factura en los datos del emisor (CC, Cédula de ciudadanía, NIT…), si lo trae. */
  docTypeText?: string;
}

/** Contenido leído de una factura o nota crédito electrónica (lo que guarda `data`). */
export interface ParsedPurchase {
  pageCount: number;
  /** Título tal como aparece (ej. «FACTURA ELECTRÓNICA DE VENTA»). */
  title: string;
  number?: string;
  cufe?: string;
  /** AAAA-MM-DD (fecha de expedición). */
  issueDate?: string;
  issuer: PurchaseIssuer;
  buyerNit?: string;
  buyerName?: string;
  lines: PurchaseLine[];
  subtotalCents?: number;
  grossTotalCents?: number;
  /** IVA total del documento. */
  vatCents?: number;
  /** «Rete fuente» de Datos Totales (retención en la fuente informada). */
  retefuenteCents?: number;
  /** Total a pagar de la factura (Total neto factura / Total factura), si se encontró. */
  totalCents?: number;
}

export type PurchaseDocStatus = "current" | "evidence" | "superseded";

export interface PurchaseDocument {
  id: number;
  uploadId: number;
  fileName: string;
  buyerNit: string;
  buyerName: string;
  year: number | null;
  issueDate: string | null;
  issuerNit: string;
  issuerName: string;
  numberKey: string;
  totalCents: number | null;
  titleKey: string;
  cufe: string | null;
  fingerprint: string;
  status: PurchaseDocStatus;
  duplicateOf: number | null;
  data: ParsedPurchase;
  importedAt: string;
}

export interface PurchaseUpload {
  id: number;
  folderName: string;
  buyerNit: string;
  fileCount: number;
  summary: UploadSummary;
  importedAt: string;
  documentCount: number;
}

/** Resumen de una carga: lo que no se pudo leer y las excepciones de NIT comprador. */
export interface UploadSummary {
  /** Archivos que no se guardaron (ilegibles o no compatibles). */
  unreadable?: { fileName: string; kind: "incompatible" | "error"; message: string }[];
  /** NIT comprador principal de la carpeta y facturas con otro NIT. */
  dominantNit?: string;
  exceptions?: { fileName: string; buyerNit: string }[];
  /** Cantidad por NIT comprador y año. */
  byScope?: { buyerNit: string; year: number | null; count: number }[];
  duplicates?: number;
}

export interface LineClass {
  documentId: number;
  lineIndex: number;
  pucCode: string;
  concept1001: string;
  /** Conceptos de retención confirmados para la línea: `[{ rateId }]` (ids de la Tabla de retenciones). */
  retention: RetentionPick[];
  ruleId: number | null;
  scope: "rule" | "invoice";
  confirmedAt: string;
}

export interface RetentionPick {
  rateId: number;
}

export type DocFlagKind = "name_confirm" | "retention_decision" | "exclude";

export interface DocFlag {
  documentId: number;
  kind: DocFlagKind;
  value: string;
  decidedAt: string;
}

export interface AuditEntry {
  id: number;
  buyerNit: string;
  year: number | null;
  event: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface PurchasesState {
  uploads: PurchaseUpload[];
  documents: PurchaseDocument[];
  lineClasses: LineClass[];
  flags: DocFlag[];
  audit: AuditEntry[];
}

export interface PurchaseScope {
  buyerNit: string;
  year: number | null;
  documents: number;
  current: number;
  evidence: number;
  uploads: number;
}

export interface PurchaseDocFileInput {
  fileName: string;
  buyerNit: string;
  buyerName: string;
  year: number | null;
  issueDate: string | null;
  issuerNit: string;
  issuerName: string;
  numberKey: string;
  totalCents: number | null;
  titleKey: string;
  cufe: string | null;
  fingerprint: string;
  data: ParsedPurchase;
}

export interface SavePurchaseUploadInput {
  folderName: string;
  buyerNit: string;
  files: PurchaseDocFileInput[];
  summary: UploadSummary;
}

export interface SavedPurchaseDocument {
  fileName: string;
  id: number;
  status: PurchaseDocStatus;
  duplicateOf: number | null;
  sameContent: boolean;
}

export interface SavePurchaseUploadOutcome {
  uploadId: number;
  documents: SavedPurchaseDocument[];
  /** Facturas que ya estaban vigentes con el mismo contenido (otra carga): no se guardaron de nuevo. */
  unchanged: number;
}

/** Carga vigente cuyo conjunto de facturas coincide exactamente con el de la carpeta que se va a importar. */
export interface IdenticalUpload {
  uploadId: number;
  folderName: string;
  importedAt: string;
  documentCount: number;
}

export interface ReplaceFile {
  fileName: string;
  fingerprint: string;
}

export interface LineClassInput {
  documentId: number;
  lineIndex: number;
  pucCode: string;
  concept1001: string;
  retention: RetentionPick[];
  saveRule: boolean;
  supplierNit: string;
  productKey: string;
  productLabel: string;
}

export interface PurchaseRule {
  id: number;
  supplierNit: string;
  productKey: string;
  productLabel: string;
  pucCode: string;
  concept1001: string;
  retention: RetentionPick[];
  uses: number;
  sourceDocumentId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleHistory {
  id: number;
  ruleId: number;
  supplierNit: string;
  productKey: string;
  pucCode: string;
  concept1001: string;
  retention: RetentionPick[];
  sourceDocumentId: number | null;
  changedAt: string;
}

export type TitleKind = "purchase" | "return";

export const TITLE_KIND_LABEL: Record<TitleKind, string> = { purchase: "Compra", return: "Devolución de compra" };

export interface TitleType {
  titleKey: string;
  displayTitle: string;
  kind: TitleKind;
  isSystem: boolean;
}

export interface CompanyVatEntry {
  companyId: number;
  effectiveDate: string;
  responsible: boolean;
  source: "rut" | "manual";
  note: string;
  createdAt: string;
}

/** Resultado de aplicar «O-15 / O-47 no generan retención» (ver `clean_exempt_retention` en Rust). */
export interface ExemptCleanup {
  /** Reglas de Compras a las que se les quitó la retención. */
  rules: number;
  /** Reglas predeterminadas de retención del proveedor eliminadas. */
  supplierRules: number;
  /** Líneas confirmadas cuya retención calculada automáticamente se corrigió a cero. */
  lines: number;
  /** Líneas con retención informada por el emisor: se dejaron para que el usuario decida. */
  keptInformed: number;
}

export interface SupplierFiscalEntry {
  supplierNit: string;
  effectiveDate: string;
  regime: string;
  source: "factura" | "manual" | "proveedor";
  note: string;
  createdAt: string;
}

export interface PucConcept1001 {
  pucCode: string;
  conceptCode: string;
}

/** Concepto de un formato con vigencia, por año (1001). */
export interface YearConcept {
  formatCode: string;
  year: number;
  code: string;
  description: string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  isSystem: boolean;
}

export interface YearConceptInput {
  formatCode: string;
  year: number;
  code: string;
  description: string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
}

export interface YearConceptAudit {
  id: number;
  formatCode: string;
  year: number;
  code: string;
  action: "add" | "edit" | "activate" | "deactivate" | "delete" | "copy";
  oldValue: string;
  newValue: string;
  changedAt: string;
}

/** Vigencia por fecha de un concepto de la Tabla de retenciones: rige desde `effectiveFrom` hacia adelante. */
export interface RateVersion {
  rateId: number;
  effectiveFrom: string;
  baseUvtCenti: number;
  rateBp: number;
  note: string;
  createdAt: string;
}

/** Alias persistente de Catálogos Exógena. `parent`: departamento (solo municipios). */
export type AliasKind = "title_type" | "document_type" | "municipality" | "department" | "country";

export interface ExoAlias {
  kind: AliasKind;
  aliasKey: string;
  parent: string;
  alias: string;
  target: string;
  updatedAt: string;
}

export const ALIAS_KIND_LABEL: Record<AliasKind, string> = { title_type: "Tipo de comprobante", document_type: "Tipo de documento de identificación", municipality: "Municipio", department: "Departamento", country: "País" };
