import type { Company, CompanyInput } from "../types/models";
import { call } from "./tauri";

export const companyService = {
  list: (search?: string) => call<Company[]>("list_companies", { search: search || null }),
  create: (input: CompanyInput) => call<Company>("create_company", { input }),
  update: (id: number, input: CompanyInput) => call<Company>("update_company", { id, input }),
  remove: (id: number) => call<void>("delete_company", { id }),
  /** Abre el diálogo nativo y copia la imagen al directorio de datos de la app. */
  pickLogo: () => call<{ logoFile: string; dataUrl: string } | null>("pick_company_logo"),
};

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
