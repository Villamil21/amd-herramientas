import type { Company, CompanyDocumentKind, CompanyInput } from "../types/models";
import { call } from "./tauri";

export const companyService = {
  list: (search?: string) => call<Company[]>("list_companies", { search: search || null }),
  create: (input: CompanyInput) => call<Company>("create_company", { input }),
  update: (id: number, input: CompanyInput) => call<Company>("update_company", { id, input }),
  remove: (id: number) => call<void>("delete_company", { id }),
  /** Abre el diálogo nativo y copia la imagen al directorio de datos de la app. */
  pickLogo: () => call<{ logoFile: string; dataUrl: string } | null>("pick_company_logo"),
  /** Abre el diálogo nativo y copia el PDF al almacenamiento de la app; no se registra hasta guardar la empresa. */
  pickDocument: (kind: CompanyDocumentKind) => call<PickedDocument | null>("pick_company_document", { kind }),
  /** Descarta un PDF cargado en el formulario que nunca se guardó (una versión registrada jamás se borra). */
  discardDocument: (storedFile: string) => call<void>("discard_company_document", { storedFile }),
  /** El PDF de cualquier versión, en base64. */
  readDocument: (storedFile: string) => call<string>("read_company_document", { storedFile }),
  /** Guarda una copia de una versión donde elija el usuario. Devuelve la ruta o `null` si canceló. */
  downloadDocument: (storedFile: string, suggestedName: string) => call<string | null>("download_company_document", { storedFile, suggestedName }),
};

export interface PickedDocument {
  storedFile: string;
  fileName: string;
  sizeBytes: number;
  dataBase64: string;
}

const logoCache = new Map<string, Promise<string | null>>();

/** Data URL del logo (con caché: los archivos de logo nunca cambian de contenido). */
export function getLogoDataUrl(logoFile: string | null | undefined): Promise<string | null> {
  if (!logoFile) return Promise.resolve(null);
  let cached = logoCache.get(logoFile);
  if (!cached) {
    cached = call<string | null>("get_logo_data_url", { logoFile }).catch(() => null);
    logoCache.set(logoFile, cached);
  }
  return cached;
}
