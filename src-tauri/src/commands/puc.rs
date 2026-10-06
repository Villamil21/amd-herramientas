//! Estados Financieros → Códigos PUC por factura. El catálogo solo se lista
//! (no hay comandos para modificarlo); la clasificación de títulos sí se
//! guarda, igual que los códigos usados con cada proveedor. Los PDF se leen
//! con los comandos de `invoices`.

use tauri::State;

use crate::database::{puc, Db};
use crate::error::AppResult;
use crate::models::puc::PucCode;
use crate::models::withholding::{validate_title_category, DocumentTitleMapping, DocumentTitleMappingInput};

#[tauri::command]
pub fn list_puc_codes(db: State<'_, Db>) -> AppResult<Vec<PucCode>> {
    db.with(|c| puc::list_codes(c))
}

#[tauri::command]
pub fn list_puc_document_titles(db: State<'_, Db>) -> AppResult<Vec<DocumentTitleMapping>> {
    db.with(|c| puc::list_titles(c))
}

#[tauri::command]
pub fn save_puc_document_titles(db: State<'_, Db>, items: Vec<DocumentTitleMappingInput>) -> AppResult<()> {
    let items = items.into_iter().map(DocumentTitleMappingInput::validated).collect::<AppResult<Vec<_>>>()?;
    db.with(|c| puc::save_titles(c, &items))
}

#[tauri::command]
pub fn update_puc_document_title(db: State<'_, Db>, id: i64, category: String) -> AppResult<()> {
    let category = validate_title_category(&category)?;
    db.with(|c| puc::update_title_category(c, id, &category))
}

#[tauri::command]
pub fn delete_puc_document_title(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| puc::delete_title(c, id))
}

/// Códigos PUC confirmados antes para el proveedor, del más reciente al más antiguo.
#[tauri::command]
pub fn list_supplier_puc_codes(db: State<'_, Db>, supplier_id: i64) -> AppResult<Vec<String>> {
    db.with(|c| puc::list_supplier_codes(c, supplier_id))
}

/// Guarda proveedor ↔ código al confirmar una asignación y devuelve la lista actualizada.
#[tauri::command]
pub fn record_supplier_puc_code(db: State<'_, Db>, supplier_id: i64, code: String) -> AppResult<Vec<String>> {
    db.with(|c| {
        puc::record_supplier_code(c, supplier_id, code.trim())?;
        puc::list_supplier_codes(c, supplier_id)
    })
}
