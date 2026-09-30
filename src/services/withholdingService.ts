import type {
  DocumentTitleMapping,
  DocumentTitleMappingInput,
  SupplierInput,
  TitleCategory,
  UvtValue,
  WithholdingProfileInput,
  WithholdingRate,
  WithholdingRateInput,
} from "../types/models";
import { call } from "./tauri";

export const withholdingService = {
  listRates: () => call<WithholdingRate[]>("list_withholding_rates"),
  createRate: (input: WithholdingRateInput) => call<number>("create_withholding_rate", { input }),
  /** Guarda varias ediciones de base UVT y tarifa en una sola transacción. */
  updateRates: (items: { id: number; baseUvtCenti: number; rateBp: number }[]) => call<void>("update_withholding_rates", { items }),
  removeRate: (id: number) => call<void>("delete_withholding_rate", { id }),
  countRateUsage: (id: number) => call<number>("count_withholding_rate_usage", { id }),

  listUvt: () => call<UvtValue[]>("list_uvt_values"),
  saveUvt: (year: number, valuePesos: number) => call<void>("save_uvt_value", { year, valuePesos }),
  removeUvt: (year: number) => call<void>("delete_uvt_value", { year }),

  /** PJ/PN y reglas del proveedor (las reglas se reemplazan completas). */
  saveSupplierProfile: (id: number, profile: WithholdingProfileInput) => call<void>("save_supplier_withholding", { id, profile }),
  createSupplier: (input: SupplierInput, profile: WithholdingProfileInput, fiscalRegime: string | null) =>
    call<number>("create_withholding_supplier", { input, profile, fiscalRegime }),
  setFiscalRegime: (id: number, fiscalRegime: string) => call<void>("set_supplier_fiscal_regime", { id, fiscalRegime }),

  listTitles: () => call<DocumentTitleMapping[]>("list_document_title_mappings"),
  saveTitles: (items: DocumentTitleMappingInput[]) => call<void>("save_document_title_mappings", { items }),
  updateTitle: (id: number, category: TitleCategory) => call<void>("update_document_title_mapping", { id, category }),
  removeTitle: (id: number) => call<void>("delete_document_title_mapping", { id }),
};
