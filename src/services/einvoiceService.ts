import type { EinvoiceCustomer, EinvoiceDoc, EinvoiceDocInput, SaveEinvoiceOutcome } from "../types/einvoice";
import { call } from "./tauri";

/** Documentos de venta de facturación electrónica que alimentan Exógena 1007, 1005 y 1006, y la identidad de sus clientes. */
export const einvoiceService = {
  saveDocs: (companyId: number, docs: EinvoiceDocInput[], replace = false) => call<SaveEinvoiceOutcome>("save_einvoice_docs", { input: { companyId, docs, replace } }),
  docs: (companyId: number, year: number) => call<EinvoiceDoc[]>("list_einvoice_docs", { companyId, year }),
  customers: (companyId: number) => call<EinvoiceCustomer[]>("list_einvoice_customers", { companyId }),
  saveCustomer: (customer: EinvoiceCustomer) => call<void>("save_einvoice_customer", { customer }),
};
