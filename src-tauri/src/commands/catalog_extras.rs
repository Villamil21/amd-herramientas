use tauri::State;

use crate::database::catalog_extras::{self, ExoAlias, RateVersion};
use crate::database::Db;
use crate::error::AppResult;

#[tauri::command]
pub fn list_withholding_rate_versions(db: State<'_, Db>) -> AppResult<Vec<RateVersion>> {
    db.with(|c| catalog_extras::list_rate_versions(c))
}

#[tauri::command]
pub fn save_withholding_rate_version(db: State<'_, Db>, rate_id: i64, effective_from: String, base_uvt_centi: i64, rate_bp: i64, note: String) -> AppResult<()> {
    db.with(|c| catalog_extras::save_rate_version(c, rate_id, effective_from.trim(), base_uvt_centi, rate_bp, &note))
}

#[tauri::command]
pub fn delete_withholding_rate_version(db: State<'_, Db>, rate_id: i64, effective_from: String) -> AppResult<()> {
    db.with(|c| catalog_extras::delete_rate_version(c, rate_id, effective_from.trim()))
}

#[tauri::command]
pub fn list_exo_aliases(db: State<'_, Db>, kind: Option<String>) -> AppResult<Vec<ExoAlias>> {
    db.with(|c| catalog_extras::list_aliases(c, kind.as_deref()))
}

#[tauri::command]
pub fn save_exo_alias(db: State<'_, Db>, kind: String, alias_key: String, parent: String, alias: String, target: String) -> AppResult<()> {
    db.with(|c| catalog_extras::save_alias(c, &kind, &alias_key, &parent, &alias, &target))
}

#[tauri::command]
pub fn delete_exo_alias(db: State<'_, Db>, kind: String, alias_key: String, parent: String) -> AppResult<()> {
    db.with(|c| catalog_extras::delete_alias(c, &kind, &alias_key, &parent))
}
