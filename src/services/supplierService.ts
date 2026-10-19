import type { Supplier, SupplierInput, SupplierTaxInput } from "../types/models";
import { call } from "./tauri";

export const supplierService = {
  list: (search?: string) => call<Supplier[]>("list_suppliers", { search: search || null }),
  create: (input: SupplierInput) => call<number>("create_supplier", { input }),
  update: (id: number, input: SupplierInput) => call<void>("update_supplier", { id, input }),
  remove: (id: number) => call<void>("delete_supplier", { id }),
  /** Crea (`id` null) o actualiza el proveedor junto con sus datos tributarios de Exógena, todo o nada. Devuelve el id. */
  saveWithTax: (id: number | null, input: SupplierInput, tax: SupplierTaxInput) => call<number>("save_supplier_with_tax", { id, input, tax }),
  /** Datos tributarios de un proveedor existente (por ejemplo, tomados de una factura ya revisada). */
  /** Crea la ficha mínima (NIT, origen «planilla», sin razón social ni domicilio) de SENA / ICBF. Idempotente; devuelve los NIT creados. */
  ensurePayroll: (nits: string[]) => call<string[]>("ensure_payroll_suppliers", { nits }),
  saveTaxData: (id: number, tax: SupplierTaxInput) => call<void>("save_supplier_tax_data", { id, tax }),
};
