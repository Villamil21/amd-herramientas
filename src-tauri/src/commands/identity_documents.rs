use tauri::State;

use crate::database::{identity_documents, Db};
use crate::error::AppResult;
use crate::models::identity_document::{IdentityDocumentType, IdentityDocumentTypeInput};

#[tauri::command]
pub fn list_identity_document_types(db: State<'_, Db>) -> AppResult<Vec<IdentityDocumentType>> {
    db.with(|c| identity_documents::list(c))
}

#[tauri::command]
pub fn create_identity_document_type(db: State<'_, Db>, input: IdentityDocumentTypeInput) -> AppResult<IdentityDocumentType> {
    let v = input.validated()?;
    db.with(|c| {
        let id = identity_documents::insert(c, &v)?;
        identity_documents::get(c, id)
    })
}

#[tauri::command]
pub fn update_identity_document_type(db: State<'_, Db>, id: i64, input: IdentityDocumentTypeInput) -> AppResult<IdentityDocumentType> {
    let v = input.validated()?;
    db.with(|c| {
        identity_documents::update(c, id, &v)?;
        identity_documents::get(c, id)
    })
}

#[tauri::command]
pub fn delete_identity_document_type(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| identity_documents::delete(c, id))
}
