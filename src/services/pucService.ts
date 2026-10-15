import type { DocumentTitleMapping, DocumentTitleMappingInput, PucCode, TitleCategory } from "../types/models";
import { call } from "./tauri";

/**
 * Estados Financieros → Códigos PUC por factura. El catálogo es de solo
 * lectura; la clasificación de títulos (Factura electrónica / Nota crédito)
 * es propia de este módulo. Los códigos usados con cada proveedor se guardan
 * en SQLite contra su registro en Proveedores.
 */
export const pucService = {
  /** Todo el catálogo (oficial + personalizados), en el orden del PUC. */
  listCodes: () => call<PucCode[]>("list_puc_codes"),
  /** Crea un código personalizado global; el concepto y el padre los confirma el usuario. */
  createCustomCode: (code: string, concept: string, parentCode: string) => call<PucCode>("create_custom_puc_code", { input: { code, concept, parentCode } }),
  listTitles: () => call<DocumentTitleMapping[]>("list_puc_document_titles"),
  saveTitles: (items: DocumentTitleMappingInput[]) => call<void>("save_puc_document_titles", { items }),
  updateTitle: (id: number, category: TitleCategory) => call<void>("update_puc_document_title", { id, category }),
  removeTitle: (id: number) => call<void>("delete_puc_document_title", { id }),
  /** Códigos confirmados antes para el proveedor, del más reciente al más antiguo. */
  listSupplierCodes: (supplierId: number) => call<string[]>("list_supplier_puc_codes", { supplierId }),
  /** Asocia el código al proveedor (sin duplicar) y devuelve su lista actualizada. */
  recordSupplierCode: (supplierId: number, code: string) => call<string[]>("record_supplier_puc_code", { supplierId, code }),
};
