import type { CompanyDocument, CompanyDocumentKind } from "../../../types/models";

/** PDF cargado en el formulario que se registra como versión al guardar la empresa. */
export interface PendingDocument {
  kind: CompanyDocumentKind;
  fileName: string;
  storedFile: string;
  sizeBytes: number;
}

export interface VersionRow {
  /** Clave estable de la fila (el archivo guardado). */
  key: string;
  fileName: string;
  storedFile: string;
  sizeBytes: number;
  /** `null` mientras no se guarda la empresa. */
  uploadedAt: string | null;
  /** Aún no registrada: se guarda con la empresa. */
  pending: boolean;
  /** La versión vigente de su tipo: la más reciente. */
  isCurrent: boolean;
}

export const KIND_LABEL: Record<CompanyDocumentKind, string> = { rut: "RUT", camara: "Cámara de Comercio" };

/**
 * Historial de un tipo de documento, de la versión más reciente a la más antigua. Las cargas sin guardar
 * son más recientes que cualquiera ya registrada y la última cargada pasa a ser la vigente; las anteriores
 * nunca se pierden.
 */
export function versionHistory(saved: CompanyDocument[], pending: PendingDocument[], kind: CompanyDocumentKind): VersionRow[] {
  const registered = saved
    .filter((d) => d.kind === kind)
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.id - b.id)
    .map((d): VersionRow => ({ key: d.storedFile, fileName: d.fileName, storedFile: d.storedFile, sizeBytes: d.sizeBytes, uploadedAt: d.uploadedAt, pending: false, isCurrent: false }));
  const uploaded = pending.filter((d) => d.kind === kind).map((d): VersionRow => ({ key: d.storedFile, fileName: d.fileName, storedFile: d.storedFile, sizeBytes: d.sizeBytes, uploadedAt: null, pending: true, isCurrent: false }));
  const ordered = [...registered, ...uploaded];
  if (ordered.length) ordered[ordered.length - 1].isCurrent = true;
  return ordered.reverse();
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
