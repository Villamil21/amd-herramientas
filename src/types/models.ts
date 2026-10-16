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
  /** Representante legal (Estados Financieros). El cargo siempre es «Representante Legal». Vacío = sin configurar. */
  legalRepName: string;
  legalRepDocument: string;
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
  /** Cómo se muestra como contador en los Estados Financieros. "" = sin definir (nunca se deduce del nombre). */
  accountantTitle: AccountantTitle;
  /** «No usar como contador en EEFF». Sin título y sin esta marca = «Pendiente EEFF». */
  fsExcluded: boolean;
  signatureFile: string;
  createdAt: string;
  updatedAt: string;
  /** El PNG existe en el almacenamiento persistente de firmas. */
  signatureAvailable: boolean;
}

export type CertificateSignerInput = Omit<CertificateSigner, "id" | "createdAt" | "updatedAt" | "signatureAvailable">;

export type AccountantTitle = "" | "Contador Público" | "Contadora Pública";

/** Rol EEFF de una firma, para mostrar: Contador/a Público/a, «Pendiente EEFF» o «No usar». */
export type SignerFsRole = "Contador Público" | "Contadora Pública" | "pending" | "excluded";

export const signerFsRole = (s: Pick<CertificateSigner, "accountantTitle" | "fsExcluded">): SignerFsRole => (s.fsExcluded ? "excluded" : s.accountantTitle || "pending");

export const SIGNER_FS_ROLE_LABEL: Record<SignerFsRole, string> = { "Contador Público": "Contador Público", "Contadora Pública": "Contadora Pública", pending: "Pendiente EEFF", excluded: "No usar" };

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
  /** null: backup anterior a la clasificación de títulos de IVA de compras; al restaurarlo se conservan los actuales. */
  vatDocumentTitles: number | null;
  pucDocumentTitles: number | null;
  /** null: backup anterior a los códigos PUC por proveedor; al restaurarlo se conservan los actuales. */
  supplierPucCodes: number | null;
  /** null: backup anterior al SMMLV por año; al restaurarlo se conservan los valores actuales. */
  minimumWages: number | null;
  /** Movimientos contables de Estados Financieros. null: backup anterior; al restaurarlo se conserva la información actual. */
  financialStatements: number | null;
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
  /** null: sin configurar (proveedor creado solo con NIT y razón social). IVA de compras lo pide cuando lo necesita. */
  vatType: VatType | null;
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

/** SMMLV de un año (Datos → SMMLV por año). Pesos enteros. */
export interface MinimumWage {
  year: number;
  valuePesos: number;
  /** Auxilio de transporte mensual del año. null: sin configurar. */
  transportAllowancePesos: number | null;
  updatedAt: string;
}

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

/** Código del catálogo PUC: oficial (solo lectura) o personalizado (creado en la app, global). */
export interface PucCode {
  /** Oficial: 1 dígito (clase), 2 (grupo), 4 (cuenta) o 6 (subcuenta asignable). Personalizado: 4 a 12 dígitos, asignable. */
  code: string;
  concept: string;
  custom?: boolean;
  /** Padre confirmado por el usuario (solo personalizados). */
  parentCode?: string;
  /** false: inactivo, no se ofrece en nuevas selecciones (lo histórico lo conserva). */
  active?: boolean;
  /** Denominación del catálogo cuando el usuario cambió la de una cuenta oficial. */
  officialConcept?: string;
}

/** Referencias de un código PUC por clase (ej. 3 movimientos de compras). */
export interface PucUsage {
  code: string;
  total: number;
  items: { kind: string; count: number }[];
}

/** Edición de una fila de la Tabla de Códigos PUC. */
export interface PucCodeUpdate {
  code: string;
  /** Solo personalizados sin uso. */
  newCode?: string;
  /** Oficial: vacío = volver a la denominación del catálogo. */
  concept: string;
  /** Solo personalizados. */
  parentCode?: string;
}

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
