use tauri::State;

use crate::database::crypto::{self, CryptoState, Homologation, SaveUploadInput, SaveUploadOutcome};
use crate::database::Db;
use crate::error::AppResult;

#[tauri::command]
pub fn get_crypto_state(db: State<'_, Db>, company_id: i64, year: i64) -> AppResult<CryptoState> {
    db.with(|c| crypto::state(c, company_id, year))
}

#[tauri::command]
pub fn save_crypto_upload(db: State<'_, Db>, input: SaveUploadInput) -> AppResult<SaveUploadOutcome> {
    db.with(|c| crypto::save_upload(c, &input))
}

#[tauri::command]
pub fn set_crypto_upload_status(db: State<'_, Db>, upload_id: i64, status: String) -> AppResult<()> {
    db.with(|c| crypto::set_upload_status(c, upload_id, &status))
}

#[tauri::command]
pub fn set_crypto_upload_coverage(db: State<'_, Db>, upload_id: i64, months: Option<Vec<String>>) -> AppResult<()> {
    db.with(|c| crypto::set_upload_coverage(c, upload_id, months.as_deref()))
}

#[tauri::command]
pub fn set_crypto_decision(db: State<'_, Db>, company_id: i64, year: i64, kind: String, key: String, value: String, fingerprint: Option<String>) -> AppResult<()> {
    db.with(|c| crypto::set_decision(c, company_id, year, &kind, &key, &value, fingerprint.as_deref().unwrap_or("")))
}

#[tauri::command]
pub fn delete_crypto_decision(db: State<'_, Db>, company_id: i64, year: i64, kind: String, key: String) -> AppResult<()> {
    db.with(|c| crypto::delete_decision(c, company_id, year, &kind, &key))
}

#[tauri::command]
pub fn list_crypto_homologations(db: State<'_, Db>) -> AppResult<Vec<Homologation>> {
    db.with(|c| crypto::list_homologations(c))
}

#[tauri::command]
pub fn save_crypto_homologation(db: State<'_, Db>, kind: String, source_key: String, value: String) -> AppResult<()> {
    db.with(|c| crypto::save_homologation(c, &kind, &source_key, &value))
}
