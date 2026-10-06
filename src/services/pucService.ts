import type { DocumentTitleMapping, DocumentTitleMappingInput, PucCode, TitleCategory } from "../types/models";
import { call } from "./tauri";

/**
 * Estados Financieros → Códigos PUC por factura. El catálogo es de solo
 * lectura; la clasificación de títulos (Factura electrónica / Nota crédito)
 * es propia de este módulo.
 */
export const pucService = {
  /** Todo el catálogo, en el orden del PUC. */
  listCodes: () => call<PucCode[]>("list_puc_codes"),
  listTitles: () => call<DocumentTitleMapping[]>("list_puc_document_titles"),
  saveTitles: (items: DocumentTitleMappingInput[]) => call<void>("save_puc_document_titles", { items }),
  updateTitle: (id: number, category: TitleCategory) => call<void>("update_puc_document_title", { id, category }),
  removeTitle: (id: number) => call<void>("delete_puc_document_title", { id }),
};
