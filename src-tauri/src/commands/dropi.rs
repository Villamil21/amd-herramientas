use tauri::State;

use crate::database::{dropi, Db};
use crate::error::AppResult;
use crate::models::dropi::{validate_category, DropiStatusMapping, DropiStatusMappingInput};

#[tauri::command]
pub fn list_dropi_status_mappings(db: State<'_, Db>) -> AppResult<Vec<DropiStatusMapping>> {
    db.with(|c| dropi::list(c))
}

#[tauri::command]
pub fn save_dropi_status_mappings(db: State<'_, Db>, items: Vec<DropiStatusMappingInput>) -> AppResult<()> {
    let items = items.into_iter().map(DropiStatusMappingInput::validated).collect::<AppResult<Vec<_>>>()?;
    db.with(|c| dropi::save_many(c, &items))
}

#[tauri::command]
pub fn update_dropi_status_mapping(db: State<'_, Db>, id: i64, category: String) -> AppResult<()> {
    let category = validate_category(&category)?;
    db.with(|c| dropi::update_category(c, id, &category))
}

#[tauri::command]
pub fn delete_dropi_status_mapping(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| dropi::delete(c, id))
}
