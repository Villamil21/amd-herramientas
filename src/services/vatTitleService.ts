import type { DocumentTitleMapping, DocumentTitleMappingInput, TitleCategory } from "../types/models";
import { call } from "./tauri";

/** IVA de compras: título de documento → Factura electrónica / Nota crédito (tabla propia del módulo). */
export const vatTitleService = {
  list: () => call<DocumentTitleMapping[]>("list_vat_document_titles"),
  save: (items: DocumentTitleMappingInput[]) => call<void>("save_vat_document_titles", { items }),
  update: (id: number, category: TitleCategory) => call<void>("update_vat_document_title", { id, category }),
  remove: (id: number) => call<void>("delete_vat_document_title", { id }),
};
