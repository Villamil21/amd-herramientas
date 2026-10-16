use tauri::State;

use crate::database::{suppliers, Db};
use crate::error::AppResult;
use crate::models::supplier::{Supplier, SupplierInput, SupplierTaxInput};

#[tauri::command]
pub fn list_suppliers(db: State<'_, Db>, search: Option<String>) -> AppResult<Vec<Supplier>> {
    db.with(|c| suppliers::list(c, search.as_deref()))
}

#[tauri::command]
pub fn create_supplier(db: State<'_, Db>, input: SupplierInput) -> AppResult<i64> {
    let input = input.validated()?;
    db.with(|c| suppliers::insert(c, &input))
}

#[tauri::command]
pub fn update_supplier(db: State<'_, Db>, id: i64, input: SupplierInput) -> AppResult<()> {
    let input = input.validated()?;
    db.with(|c| suppliers::update(c, id, &input))
}

#[tauri::command]
pub fn delete_supplier(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| suppliers::delete(c, id))
}

/// Crea (`id` vacío) o actualiza un proveedor junto con sus datos tributarios de Exógena, todo o nada.
#[tauri::command]
pub fn save_supplier_with_tax(db: State<'_, Db>, id: Option<i64>, input: SupplierInput, tax: SupplierTaxInput) -> AppResult<i64> {
    let tax = tax.validated()?;
    let input = input.validated_for(tax.data.doc_type_code.as_deref())?;
    db.with(|c| suppliers::save_with_tax(c, id, &input, &tax))
}

/// Aplica datos tributarios (por ejemplo, desde una factura ya revisada) sin tocar NIT, razón social ni Tipo IVA.
#[tauri::command]
pub fn save_supplier_tax_data(db: State<'_, Db>, id: i64, tax: SupplierTaxInput) -> AppResult<()> {
    let tax = tax.validated()?;
    db.with(|c| suppliers::save_tax_data(c, id, &tax))
}
