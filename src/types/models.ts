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
  createdAt: string;
  updatedAt: string;
}

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
}
