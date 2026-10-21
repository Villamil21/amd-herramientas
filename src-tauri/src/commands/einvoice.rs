use tauri::State;

use crate::database::einvoice::{self, EinvoiceCustomer, EinvoiceDoc, SaveEinvoiceInput, SaveEinvoiceOutcome};
use crate::database::Db;
use crate::error::AppResult;

#[tauri::command]
pub fn save_einvoice_docs(db: State<'_, Db>, input: SaveEinvoiceInput) -> AppResult<SaveEinvoiceOutcome> {
    db.with(|c| einvoice::save_docs(c, &input))
}

#[tauri::command]
pub fn list_einvoice_docs(db: State<'_, Db>, company_id: i64, year: i64) -> AppResult<Vec<EinvoiceDoc>> {
    db.with(|c| einvoice::list_docs(c, company_id, year))
}

#[tauri::command]
pub fn list_einvoice_customers(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<EinvoiceCustomer>> {
    db.with(|c| einvoice::list_customers(c, company_id))
}

#[tauri::command]
pub fn save_einvoice_customer(db: State<'_, Db>, customer: EinvoiceCustomer) -> AppResult<()> {
    db.with(|c| einvoice::save_customer(c, &customer))
}
