//! Obligaciones tributarias de Estados Financieros. La lectura de cada
//! declaración (PDF) ocurre en el frontend; aquí se guardan con sus reglas.

use tauri::State;

use crate::database::{tax, Db};
use crate::error::AppResult;
use crate::models::tax::*;

#[tauri::command]
pub fn list_fs_tax_returns(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<TaxReturn>> {
    db.with(|c| tax::list(c, company_id))
}

#[tauri::command]
pub fn save_fs_tax_return(db: State<'_, Db>, input: TaxReturnInput) -> AppResult<i64> {
    db.with(|c| tax::save(c, &input))
}

#[tauri::command]
pub fn set_fs_tax_return_payment(db: State<'_, Db>, id: i64, payment_date: Option<String>) -> AppResult<()> {
    db.with(|c| tax::set_payment_date(c, id, payment_date))
}

#[tauri::command]
pub fn set_fs_tax_return_resolution(db: State<'_, Db>, id: i64, resolution: String) -> AppResult<()> {
    db.with(|c| tax::set_resolution(c, id, &resolution))
}

#[tauri::command]
pub fn get_fs_tax_settings(db: State<'_, Db>, company_id: i64) -> AppResult<TaxCompanySettings> {
    db.with(|c| tax::get_settings(c, company_id))
}

#[tauri::command]
pub fn save_fs_tax_settings(db: State<'_, Db>, settings: TaxCompanySettings) -> AppResult<()> {
    db.with(|c| tax::save_settings(c, &settings))
}
