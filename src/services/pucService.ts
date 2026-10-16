import type { DocumentTitleMapping, DocumentTitleMappingInput, PucCode, PucCodeUpdate, PucUsage, TitleCategory } from "../types/models";
import { call } from "./tauri";

/**
 * Estados Financieros → Códigos PUC por factura y Tabla de Códigos PUC. Las
 * cuentas oficiales nunca se borran; los personalizados sin uso sí. La clasificación de títulos (Factura electrónica / Nota crédito)
 * es propia de este módulo. Los códigos usados con cada proveedor se guardan
 * en SQLite contra su registro en Proveedores.
 */
export const pucService = {
  /** Todo el catálogo (oficial + personalizados), en el orden del PUC. */
  listCodes: () => call<PucCode[]>("list_puc_codes"),
  /** Crea un código personalizado global; el concepto y el padre los confirma el usuario. */
  createCustomCode: (code: string, concept: string, parentCode: string) => call<PucCode>("create_custom_puc_code", { input: { code, concept, parentCode } }),
  /** Códigos con alguna referencia (movimientos, configuraciones, historial…). */
  listUsage: () => call<PucUsage[]>("list_puc_usage"),
  usage: (code: string) => call<PucUsage>("get_puc_code_usage", { code }),
  /** Concepto; en un personalizado sin uso también el número y el padre. */
  updateCode: (input: PucCodeUpdate) => call<PucCode>("update_puc_code", { input }),
  setActive: (code: string, active: boolean) => call<PucCode>("set_puc_code_active", { code, active }),
  /** Solo personalizados sin ninguna referencia. */
  deleteCode: (code: string) => call<void>("delete_custom_puc_code", { code }),
  listTitles: () => call<DocumentTitleMapping[]>("list_puc_document_titles"),
  saveTitles: (items: DocumentTitleMappingInput[]) => call<void>("save_puc_document_titles", { items }),
  updateTitle: (id: number, category: TitleCategory) => call<void>("update_puc_document_title", { id, category }),
  removeTitle: (id: number) => call<void>("delete_puc_document_title", { id }),
  /** Códigos confirmados antes para el proveedor, del más reciente al más antiguo. */
  listSupplierCodes: (supplierId: number) => call<string[]>("list_supplier_puc_codes", { supplierId }),
  /** Asocia el código al proveedor (sin duplicar) y devuelve su lista actualizada. */
  recordSupplierCode: (supplierId: number, code: string) => call<string[]>("record_supplier_puc_code", { supplierId, code }),
  /** Quita una asociación de sugerencia (los movimientos ya enviados no cambian). */
  deleteSupplierCode: (supplierId: number, code: string) => call<string[]>("delete_supplier_puc_code", { supplierId, code }),
  replaceSupplierCode: (supplierId: number, from: string, to: string) => call<string[]>("replace_supplier_puc_code", { supplierId, from, to }),
};
