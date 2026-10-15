import { call } from "../../../../services/tauri";
import type { TaxCompanySettings, TaxResolution, TaxReturn, TaxReturnInput } from "../types";

export const taxService = {
  list: (companyId: number) => call<TaxReturn[]>("list_fs_tax_returns", { companyId }),
  save: (input: TaxReturnInput) => call<number>("save_fs_tax_return", { input }),
  /** null quita la fecha de pago. */
  setPayment: (id: number, paymentDate: string | null) => call<void>("set_fs_tax_return_payment", { id, paymentDate }),
  setResolution: (id: number, resolution: TaxResolution) => call<void>("set_fs_tax_return_resolution", { id, resolution }),
  settings: (companyId: number) => call<TaxCompanySettings>("get_fs_tax_settings", { companyId }),
  saveSettings: (settings: TaxCompanySettings) => call<void>("save_fs_tax_settings", { settings }),
};
