use std::path::PathBuf;
use std::sync::Mutex;

use crate::services::backup_json::BackupFile;
use crate::services::paths::AppPaths;
use crate::startup::StartupInfo;

pub struct AppState {
    pub paths: AppPaths,
    pub startup: StartupInfo,
    /// Backup leído y validado, esperando confirmación del usuario.
    pub pending_backup: Mutex<Option<BackupFile>>,
    /// Archivos guardados en esta sesión: los únicos que la app puede abrir o mostrar en Finder.
    pub saved_files: Mutex<Vec<PathBuf>>,
}
