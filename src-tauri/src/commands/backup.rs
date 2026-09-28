use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::to_path;
use crate::database::Db;
use crate::error::{AppError, AppResult};
use crate::services::backup_json::{self, BackupSummary};
use crate::services::backups::{self, KEEP_AUTOMATIC_BACKUPS, PREFIX_BEFORE_IMPORT};
use crate::services::time::now_compact;
use crate::state::AppState;

const MAX_BACKUP_BYTES: u64 = 200 * 1024 * 1024;

#[tauri::command]
pub async fn export_backup(app: AppHandle, db: State<'_, Db>, state: State<'_, AppState>) -> AppResult<Option<String>> {
    let version = app.package_info().version.to_string();
    let file = db.with(|c| backup_json::build(c, &state.paths.logos_dir, &state.paths.signatures_dir, &version))?;
    let json = serde_json::to_vec_pretty(&file)?;

    let default_name = format!("herramientas-backup-{}.json", &now_compact()[..8]);
    let Some(fp) = app
        .dialog()
        .file()
        .set_title("Exportar datos")
        .set_file_name(default_name)
        .add_filter("Backup JSON", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = to_path(fp)?;
    std::fs::write(&path, json)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Paso 1 de la importación: leer y validar. No modifica nada.
#[tauri::command]
pub async fn pick_backup_file(app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<BackupSummary>> {
    let Some(fp) = app
        .dialog()
        .file()
        .set_title("Importar datos")
        .add_filter("Backup JSON", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = to_path(fp)?;
    if std::fs::metadata(&path)?.len() > MAX_BACKUP_BYTES {
        return Err(AppError::user("El archivo de backup es demasiado grande."));
    }
    let file = backup_json::parse(&std::fs::read(&path)?)?;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let summary = backup_json::summary(&name, &file);
    *state.pending_backup.lock().map_err(|_| AppError::user("Inténtalo de nuevo."))? = Some(file);
    Ok(Some(summary))
}

/// Paso 2: el usuario confirmó. Se crea una copia .sqlite y se reemplazan los datos.
#[tauri::command]
pub fn apply_pending_backup(db: State<'_, Db>, state: State<'_, AppState>) -> AppResult<()> {
    let file = state
        .pending_backup
        .lock()
        .map_err(|_| AppError::user("Inténtalo de nuevo."))?
        .take()
        .ok_or_else(|| AppError::user("Primero selecciona un archivo de backup."))?;
    db.with(|c| {
        backups::snapshot(c, &state.paths.backups_dir, PREFIX_BEFORE_IMPORT, "json")?;
        backups::prune(&state.paths.backups_dir, PREFIX_BEFORE_IMPORT, None, KEEP_AUTOMATIC_BACKUPS)?;
        backup_json::restore(c, &state.paths.logos_dir, &state.paths.signatures_dir, &file)
    })
}

#[tauri::command]
pub fn discard_pending_backup(state: State<'_, AppState>) {
    if let Ok(mut p) = state.pending_backup.lock() {
        *p = None;
    }
}
