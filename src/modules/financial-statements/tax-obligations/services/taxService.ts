import { call } from "../../../../services/tauri";
import type { TaxCompanySettings, TaxPaymentInput, TaxResolution, TaxReturn, TaxReturnInput } from "../types";

export const taxService = {
  list: (companyId: number) => call<TaxReturn[]>("list_fs_tax_returns", { companyId }),
  save: (input: TaxReturnInput) => call<number>("save_fs_tax_return", { input }),
  addPayment: (returnId: number, input: TaxPaymentInput) => call<number>("add_fs_tax_payment", { returnId, input }),
  updatePayment: (id: number, input: TaxPaymentInput) => call<void>("update_fs_tax_payment", { id, input }),
  deletePayment: (id: number) => call<void>("delete_fs_tax_payment", { id }),
  setResolution: (id: number, resolution: TaxResolution) => call<void>("set_fs_tax_return_resolution", { id, resolution }),
  settings: (companyId: number) => call<TaxCompanySettings>("get_fs_tax_settings", { companyId }),
  saveSettings: (settings: TaxCompanySettings) => call<void>("save_fs_tax_settings", { settings }),
};
