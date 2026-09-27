use tauri::State;

use crate::database::{concepts, Db};
use crate::error::AppResult;
use crate::models::concept::{Concept, ConceptInput};

#[tauri::command]
pub fn list_concepts(db: State<'_, Db>, search: Option<String>) -> AppResult<Vec<Concept>> {
    db.with(|c| concepts::list(c, search.as_deref()))
}

#[tauri::command]
pub fn create_concept(db: State<'_, Db>, input: ConceptInput) -> AppResult<i64> {
    let input = input.validated()?;
    db.with(|c| concepts::insert(c, &input))
}

#[tauri::command]
pub fn update_concept(db: State<'_, Db>, id: i64, input: ConceptInput) -> AppResult<()> {
    let input = input.validated()?;
    db.with(|c| concepts::update(c, id, &input))
}

#[tauri::command]
pub fn delete_concept(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| concepts::delete(c, id))
}
