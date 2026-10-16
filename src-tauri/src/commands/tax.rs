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
pub fn add_fs_tax_payment(db: State<'_, Db>, return_id: i64, input: TaxPaymentInput) -> AppResult<i64> {
    db.with(|c| tax::add_payment(c, return_id, &input))
}

#[tauri::command]
pub fn update_fs_tax_payment(db: State<'_, Db>, id: i64, input: TaxPaymentInput) -> AppResult<()> {
    db.with(|c| tax::update_payment(c, id, &input))
}

#[tauri::command]
pub fn delete_fs_tax_payment(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| tax::delete_payment(c, id))
}

#[tauri::command]
pub fn set_fs_tax_excess_review(db: State<'_, Db>, payment_id: i64, decision: String, fingerprint: String) -> AppResult<()> {
    db.with(|c| tax::set_excess_review(c, payment_id, &decision, &fingerprint))
}

#[tauri::command]
pub fn patch_fs_tax_return_detail(db: State<'_, Db>, id: i64, patch: serde_json::Value, note: String) -> AppResult<()> {
    db.with(|c| tax::patch_detail(c, id, &patch, &note))
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

#[tauri::command]
pub fn list_fs_tax_empty_periods(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<TaxEmptyPeriod>> {
    db.with(|c| tax::list_empty_periods(c, company_id))
}

#[tauri::command]
pub fn register_fs_tax_empty_period(db: State<'_, Db>, input: TaxEmptyPeriodInput) -> AppResult<i64> {
    db.with(|c| tax::register_empty_period(c, &input))
}

#[tauri::command]
pub fn void_fs_tax_empty_period(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| tax::void_empty_period(c, id))
}
