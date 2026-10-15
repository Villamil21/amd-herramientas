//! Tabla de Códigos PUC y Estados Financieros → Clasificación contable de
//! compras. El catálogo oficial nunca se borra; los códigos personalizados se
//! crean, editan y (sin uso) eliminan aquí. La clasificación de títulos se guarda, igual que los códigos
//! usados con cada proveedor. Los PDF se leen con los comandos de `invoices`.

use tauri::State;

use crate::database::{puc, Db};
use crate::error::AppResult;
use crate::models::puc::{CustomPucCodeInput, PucCode, PucCodeUpdateInput, PucUsage};
use crate::models::withholding::{validate_title_category, DocumentTitleMapping, DocumentTitleMappingInput};

/// Catálogo oficial + códigos personalizados.
#[tauri::command]
pub fn list_puc_codes(db: State<'_, Db>) -> AppResult<Vec<PucCode>> {
    db.with(|c| puc::list_all_codes(c))
}

/// Crea un código personalizado (global). El concepto y el padre los confirma el usuario.
#[tauri::command]
pub fn create_custom_puc_code(db: State<'_, Db>, input: CustomPucCodeInput) -> AppResult<PucCode> {
    db.with(|c| puc::create_custom_code(c, &input))
}

/// Códigos con alguna referencia (columna «En uso»).
#[tauri::command]
pub fn list_puc_usage(db: State<'_, Db>) -> AppResult<Vec<PucUsage>> {
    db.with(|c| puc::list_usage(c))
}

/// Referencias de un código («Ver referencias»).
#[tauri::command]
pub fn get_puc_code_usage(db: State<'_, Db>, code: String) -> AppResult<PucUsage> {
    db.with(|c| puc::code_usage(c, code.trim()))
}

/// Edita concepto (y, en un personalizado sin uso, el número y el padre).
#[tauri::command]
pub fn update_puc_code(db: State<'_, Db>, input: PucCodeUpdateInput) -> AppResult<PucCode> {
    db.with(|c| puc::update_code(c, &input))
}

/// Desactiva o reactiva un código asignable.
#[tauri::command]
pub fn set_puc_code_active(db: State<'_, Db>, code: String, active: bool) -> AppResult<PucCode> {
    db.with(|c| puc::set_code_active(c, &code, active))
}

/// Elimina un código personalizado sin referencias.
#[tauri::command]
pub fn delete_custom_puc_code(db: State<'_, Db>, code: String) -> AppResult<()> {
    db.with(|c| puc::delete_custom_code(c, &code))
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
