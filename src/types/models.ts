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
}

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
}

export type SupplierInput = Omit<Supplier, "id" | "createdAt" | "updatedAt">;

/** Clasificación guardada de un estado de Dropi (global al módulo Dropi). */
export interface DropiStatusMapping {
  id: number;
  /** Sin tildes, en mayúsculas, "_" como espacio. */
  normalizedStatus: string;
  displayStatus: string;
  category: "in_process" | "claim";
  createdAt: string;
  updatedAt: string;
}

export type DropiStatusMappingInput = Pick<DropiStatusMapping, "normalizedStatus" | "displayStatus" | "category">;
