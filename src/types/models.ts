export interface Company {
  id: number;
  razonSocial: string;
  nit: string;
  direccion: string;
  ciudad: string;
  telefono: string;
  correo: string;
  infoAdicional: string;
  logoFile: string | null;
  dv: string;
  subscribedTotalShares: number | null;
  subscribedNominalValue: number | null;
  paidTotalShares: number | null;
  paidNominalValue: number | null;
  /** Código CIIU como texto (conserva ceros iniciales: "0111"). Vacío = sin configurar. */
  ciiuCode: string;
  shareholders: Shareholder[];
  createdAt: string;
  updatedAt: string;
}

export interface Shareholder {
  id?: number;
  name: string;
  identityDocument: string;
  percentage: number;
  sortOrder: number;
}

export interface CertificateSigner {
  id: number;
  name: string;
  role: string;
  professionalDocument: string;
  /** Identificación personal (ej. "CC 1.192.729.629"). Opcional: "" si no se ha registrado. */
  personalDocument: string;
  signatureFile: string;
  createdAt: string;
  updatedAt: string;
  /** El PNG existe en el almacenamiento persistente de firmas. */
  signatureAvailable: boolean;
}

export type CertificateSignerInput = Omit<CertificateSigner, "id" | "createdAt" | "updatedAt" | "signatureAvailable">;

export type CompanyInput = Omit<Company, "id" | "createdAt" | "updatedAt">;

export type TipoRetencion = "RETEFUENTE" | "ICA";
export type UnidadTarifa = "PORCENTAJE" | "POR_MIL";

export interface Concept {
  id: number;
  nombre: string;
  tipoRetencion: TipoRetencion;
  tarifaPredeterminada: number | null;
  unidadTarifa: UnidadTarifa;
  createdAt: string;
  updatedAt: string;
}

export type ConceptInput = Omit<Concept, "id" | "createdAt" | "updatedAt">;

export const TIPO_RETENCION_LABEL: Record<TipoRetencion, string> = {
  RETEFUENTE: "Retención en la fuente",
  ICA: "ICA",
};

export const UNIDAD_TARIFA_LABEL: Record<UnidadTarifa, string> = {
  PORCENTAJE: "Porcentaje (%)",
  POR_MIL: "Por mil (‰)",
};

export const UNIDAD_TARIFA_SYMBOL: Record<UnidadTarifa, string> = {
  PORCENTAJE: "%",
  POR_MIL: "‰",
};

export interface StartupInfo {
  currentVersion: string;
  previousVersion: string | null;
  updated: boolean;
  migrationsApplied: string[];
  backupFile: string | null;
  databaseError: string | null;
}

export interface BackupSummary {
  fileName: string;
  appVersion: string;
  exportedAt: string;
  companies: number;
  concepts: number;
  settings: number;
  /** null: backup anterior a las firmas; al restaurarlo se conservan los firmantes actuales. */
  signers: number | null;
  /** null: backup anterior a los proveedores; al restaurarlo se conservan los proveedores actuales. */
  suppliers: number | null;
  /** null: backup anterior a los estados de Dropi; al restaurarlo se conservan las reglas actuales. */
  dropiStatusMappings: number | null;
  /** null: backup anterior a Retención en la fuente; al restaurarlo se conservan la tabla, los UVT y los títulos actuales. */
  withholdingRates: number | null;
  uvtValues: number | null;
  documentTitleMappings: number | null;
  /** null: backup anterior al certificado de ingresos; al restaurarlo se conservan los tipos de documento actuales. */
  identityDocumentTypes: number | null;
  /** null: backup anterior a Retención en la fuente ventas; al restaurarlo se conservan la tabla y las clasificaciones actuales. */
  selfWithholdingRates: number | null;
  salesDocumentTypes: number | null;
}

/** Tipo de documento de identidad del titular (certificado de ingresos). */
export interface IdentityDocumentType {
  id: number;
  name: string;
  /** El número se muestra con separador de miles (1.006.011.707). */
  isNumeric: boolean;
  /** Tipo inicial: no se puede eliminar. */
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export type IdentityDocumentTypeInput = Pick<IdentityDocumentType, "name" | "isNumeric">;

/** Clasificación tributaria del proveedor para el análisis de IVA. */
export type VatType = "purchase" | "service";

export const VAT_TYPE_LABEL: Record<VatType, string> = { purchase: "Compras", service: "Servicios" };

export interface Supplier {
  id: number;
  /** Solo dígitos, sin dígito de verificación. */
  nit: string;
  businessName: string;
  vatType: VatType;
  createdAt: string;
  updatedAt: string;
  /** Retención en la fuente (opcionales: los proveedores creados desde IVA no los tienen). */
  personType?: PersonType | null;
  /** Régimen / responsabilidad fiscal del emisor leída en la última verificación. */
  fiscalRegime?: string | null;
  fiscalCheckedAt?: string | null;
  withholdingRules?: SupplierWithholdingRule[];
}

export type SupplierInput = Pick<Supplier, "nit" | "businessName" | "vatType">;

// ---------------------------------------------------------------------------
// Retención en la fuente
// ---------------------------------------------------------------------------

export type PersonType = "PJ" | "PN";

export const PERSON_TYPE_LABEL: Record<PersonType, string> = { PJ: "Persona jurídica", PN: "Persona natural" };

export type RetentionType = "fees" | "services" | "rentals" | "purchases";

/** En el orden del resumen para la declaración. */
export const RETENTION_TYPES: RetentionType[] = ["fees", "services", "rentals", "purchases"];

export const RETENTION_TYPE_LABEL: Record<RetentionType, string> = {
  fees: "Honorarios",
  services: "Servicios",
  rentals: "Arrendamientos",
  purchases: "Compras",
};

export type BaseMode = "invoice_subtotal" | "manual";

export const BASE_MODE_LABEL: Record<BaseMode, string> = {
  invoice_subtotal: "Subtotal de la factura",
  manual: "Base diferente / manual",
};

/** Fila de la tabla de retenciones. La base mínima en pesos se calcula con el UVT del año. */
export interface WithholdingRate {
  id: number;
  retentionType: RetentionType;
  name: string;
  /** Centésimas de UVT: 10 UVT → 1000. */
  baseUvtCenti: number;
  /** Centésimas de punto: 4 % → 400. */
  rateBp: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type WithholdingRateInput = Pick<WithholdingRate, "retentionType" | "name" | "baseUvtCenti" | "rateBp">;

export interface UvtValue {
  year: number;
  valuePesos: number;
  updatedAt: string;
}

export interface SupplierWithholdingRule {
  id: number;
  rateId: number;
  baseMode: BaseMode;
  isDefault: boolean;
}

export interface WithholdingProfileInput {
  personType: PersonType | null;
  rules: Omit<SupplierWithholdingRule, "id">[];
}

export type TitleCategory = "invoice" | "credit_note";

export const TITLE_CATEGORY_LABEL: Record<TitleCategory, string> = { invoice: "Factura", credit_note: "Nota" };

export interface DocumentTitleMapping {
  id: number;
  /** normalizeKey del título. */
  normalizedTitle: string;
  displayTitle: string;
  category: TitleCategory;
  createdAt: string;
  updatedAt: string;
}

export type DocumentTitleMappingInput = Pick<DocumentTitleMapping, "normalizedTitle" | "displayTitle" | "category">;

/** Clasificación guardada de un estado de Dropi (global al módulo Dropi). */
export interface DropiStatusMapping {
  id: number;
  /** Sin tildes, en mayúsculas, "_" como espacio. */
  normalizedStatus: string;
  displayStatus: string;
  category: "in_process" | "claim" | "indemnity";
  createdAt: string;
  updatedAt: string;
}

export type DropiStatusMappingInput = Pick<DropiStatusMapping, "normalizedStatus" | "displayStatus" | "category">;

/** Fila de Datos → Tabla de Autorretenciones (Decreto 572 de 2025, art. 1.2.6.8, editable). */
export interface SelfWithholdingRate {
  id: number;
  /** Código tal como lo trae la fuente ("111") o lo escribió el usuario. */
  ciiuCode: string;
  /** Clave de comparación: solo dígitos, a 4 posiciones si tiene 4 o menos ("0111"). */
  normalizedCode: string;
  economicActivity: string;
  /** Centésimas de punto: 1,10 % → 110. */
  rateBp: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export type SelfWithholdingRateInput = Pick<SelfWithholdingRate, "ciiuCode" | "economicActivity" | "rateBp">;

/** Categoría final de un «Tipo de documento» de la hoja Ventas. */
export type SalesCategory = "invoice" | "credit_note";

export const SALES_CATEGORY_LABEL: Record<SalesCategory, string> = { invoice: "Facturas", credit_note: "Notas Crédito" };

export interface SalesDocumentTypeMapping {
  id: number;
  /** normalizeKey del tipo de documento. */
  normalizedLabel: string;
  originalLabel: string;
  category: SalesCategory;
  createdAt: string;
  updatedAt: string;
}

export type SalesDocumentTypeMappingInput = Pick<SalesDocumentTypeMapping, "normalizedLabel" | "originalLabel" | "category">;
