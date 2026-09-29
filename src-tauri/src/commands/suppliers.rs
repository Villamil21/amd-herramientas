use tauri::State;

use crate::database::{suppliers, Db};
use crate::error::AppResult;
use crate::models::supplier::{Supplier, SupplierInput};

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
