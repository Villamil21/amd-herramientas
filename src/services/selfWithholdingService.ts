import type { SalesCategory, SalesDocumentTypeMapping, SalesDocumentTypeMappingInput, SelfWithholdingRate, SelfWithholdingRateInput } from "../types/models";
import { call } from "./tauri";

export const selfWithholdingService = {
  listRates: () => call<SelfWithholdingRate[]>("list_self_withholding_rates"),
  createRate: (input: SelfWithholdingRateInput) => call<number>("create_self_withholding_rate", { input }),
  /** Guarda varias ediciones de tarifa en una sola transacción. */
  updateRates: (items: { id: number; rateBp: number }[]) => call<void>("update_self_withholding_rates", { items }),
  removeRate: (id: number) => call<void>("delete_self_withholding_rate", { id }),

  listDocumentTypes: () => call<SalesDocumentTypeMapping[]>("list_sales_document_types"),
  saveDocumentTypes: (items: SalesDocumentTypeMappingInput[]) => call<void>("save_sales_document_types", { items }),
  updateDocumentType: (id: number, category: SalesCategory) => call<void>("update_sales_document_type", { id, category }),
  removeDocumentType: (id: number) => call<void>("delete_sales_document_type", { id }),
};
