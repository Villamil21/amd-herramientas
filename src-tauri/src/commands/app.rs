use tauri::State;

use crate::error::{AppError, AppResult};
use crate::startup::StartupInfo;
use crate::state::AppState;

#[tauri::command]
pub fn get_startup_info(state: State<'_, AppState>) -> StartupInfo {
    state.startup.clone()
}

#[tauri::command]
pub fn get_data_location(state: State<'_, AppState>) -> String {
    state.paths.data_dir.to_string_lossy().to_string()
}

/// Abre en Finder la carpeta de datos (útil para ubicar las copias automáticas).
#[tauri::command]
pub fn reveal_data_folder(state: State<'_, AppState>) -> AppResult<()> {
    std::process::Command::new("open")
        .arg(&state.paths.data_dir)
        .spawn()
        .map_err(|_| AppError::user("No se pudo abrir la carpeta en Finder."))?;
    Ok(())
}
