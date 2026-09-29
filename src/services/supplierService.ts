import type { Supplier, SupplierInput } from "../types/models";
import { call } from "./tauri";

export const supplierService = {
  list: (search?: string) => call<Supplier[]>("list_suppliers", { search: search || null }),
  create: (input: SupplierInput) => call<number>("create_supplier", { input }),
  update: (id: number, input: SupplierInput) => call<void>("update_supplier", { id, input }),
  remove: (id: number) => call<void>("delete_supplier", { id }),
};
