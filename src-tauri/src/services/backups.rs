//! Copias de seguridad automáticas de la base SQLite (.sqlite completas).
//! Se crean antes de migrar y antes de restaurar un backup JSON.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::AppResult;
use crate::services::time::now_compact;

/// Copias automáticas que se conservan por cada tipo.
pub const KEEP_AUTOMATIC_BACKUPS: usize = 5;

pub const PREFIX_BEFORE_MIGRATION: &str = "database-before-";
pub const PREFIX_BEFORE_IMPORT: &str = "database-before-import-";

fn sanitize(label: &str) -> String {
    label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' { c } else { '_' })
        .collect()
}

/// Copia consistente de la base con `VACUUM INTO` (no requiere cerrar la conexión).
pub fn snapshot(conn: &Connection, dir: &Path, prefix: &str, label: &str) -> AppResult<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let file = dir.join(format!("{prefix}{}-{}.sqlite", sanitize(label), now_compact()));
    conn.execute("VACUUM INTO ?1", [file.to_string_lossy().as_ref()])?;
    Ok(file)
}

/// Elimina las copias más antiguas de un prefijo, conservando `keep`.
/// Los backups de importación usan un prefijo más específico y se excluyen
/// de la limpieza de migraciones para no mezclarse.
pub fn prune(dir: &Path, prefix: &str, exclude_prefix: Option<&str>, keep: usize) -> AppResult<()> {
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let matches = name.starts_with(prefix)
                && name.ends_with(".sqlite")
                && exclude_prefix.map_or(true, |x| !name.starts_with(x));
            if !matches {
                return None;
            }
            let modified = e.metadata().and_then(|m| m.modified()).ok()?;
            Some((modified, e.path()))
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(keep) {
        if let Err(e) = std::fs::remove_file(&path) {
            eprintln!("[backups] no se pudo eliminar {}: {e}", path.display());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_and_prune_keep_latest() {
        let dir = std::env::temp_dir().join(format!("amd-bk-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES (1);").unwrap();

        for i in 0..7 {
            let f = dir.join(format!("{PREFIX_BEFORE_MIGRATION}1.0.{i}.sqlite"));
            std::fs::write(&f, b"x").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        std::fs::write(dir.join(format!("{PREFIX_BEFORE_IMPORT}x.sqlite")), b"x").unwrap();
        let snap = snapshot(&conn, &dir, PREFIX_BEFORE_MIGRATION, "1.1.0").unwrap();
        assert!(snap.exists());

        prune(&dir, PREFIX_BEFORE_MIGRATION, Some(PREFIX_BEFORE_IMPORT), 5).unwrap();
        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        let migration_copies = names
            .iter()
            .filter(|n| !n.starts_with(PREFIX_BEFORE_IMPORT))
            .count();
        assert_eq!(migration_copies, 5);
        assert!(names.iter().any(|n| n.starts_with(PREFIX_BEFORE_IMPORT)));
        assert!(snap.exists(), "la copia más reciente se conserva");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
