//! Arranque de la base de datos. Orden:
//! abrir → ¿hay migraciones pendientes sobre una base con datos? → copia
//! automática → migrar (transacción por paso) → registrar last_run_version.

use rusqlite::Connection;
use serde::Serialize;

use crate::database::{self, migrations};
use crate::error::AppResult;
use crate::services::backups::{self, KEEP_AUTOMATIC_BACKUPS, PREFIX_BEFORE_IMPORT, PREFIX_BEFORE_MIGRATION};
use crate::services::paths::AppPaths;
use crate::services::{logos, signatures};

pub const LAST_RUN_VERSION_KEY: &str = "last_run_version";

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct StartupInfo {
    pub current_version: String,
    pub previous_version: Option<String>,
    /// Primer arranque de una versión distinta a la anterior.
    pub updated: bool,
    pub migrations_applied: Vec<String>,
    pub backup_file: Option<String>,
    /// Mensaje para el usuario si la base no pudo abrirse o migrarse.
    pub database_error: Option<String>,
}

pub fn init(paths: &AppPaths, current_version: &str) -> (Option<Connection>, StartupInfo) {
    let mut info = StartupInfo {
        current_version: current_version.to_string(),
        ..Default::default()
    };
    match init_inner(paths, current_version, &mut info) {
        Ok(conn) => (Some(conn), info),
        Err(e) => {
            info.database_error = Some(e.0);
            (None, info)
        }
    }
}

fn init_inner(paths: &AppPaths, current_version: &str, info: &mut StartupInfo) -> AppResult<Connection> {
    let mut conn = database::open(&paths.db_file)?;
    migrations::ensure_migrations_table(&conn)?;

    let has_data = migrations::current_version(&conn)? > 0;
    if has_data && !migrations::pending(&conn)?.is_empty() {
        let file = backups::snapshot(&conn, &paths.backups_dir, PREFIX_BEFORE_MIGRATION, current_version)?;
        backups::prune(
            &paths.backups_dir,
            PREFIX_BEFORE_MIGRATION,
            Some(PREFIX_BEFORE_IMPORT),
            KEEP_AUTOMATIC_BACKUPS,
        )?;
        info.backup_file = file.file_name().map(|n| n.to_string_lossy().to_string());
    }

    info.migrations_applied = migrations::run_pending(&mut conn)?;

    let previous = database::get_setting(&conn, LAST_RUN_VERSION_KEY)?;
    info.updated = previous.as_deref().is_some_and(|p| p != current_version);
    info.previous_version = previous;
    if info.previous_version.as_deref() != Some(current_version) {
        database::set_setting(&conn, LAST_RUN_VERSION_KEY, current_version)?;
    }

    // Firmas: primero se rescatan las que versiones anteriores guardaban junto a
    // los logos (la limpieza de logos las borraría) y luego se limpian las
    // selecciones canceladas. Un firmante sin archivo se conserva como «firma faltante».
    let signature_files: Vec<String> = conn
        .prepare("SELECT signature_file FROM certificate_signers")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    signatures::migrate_legacy(&paths.signatures_dir, &paths.logos_dir, &signature_files);
    signatures::remove_orphans(&paths.signatures_dir, &signature_files);

    // Limpieza controlada: logos subidos en formularios que se cancelaron.
    let referenced: Vec<String> = conn
        .prepare("SELECT logo_file FROM companies WHERE logo_file IS NOT NULL")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    logos::remove_orphans(&paths.logos_dir, &referenced);

    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths(tag: &str) -> AppPaths {
        let dir = std::env::temp_dir().join(format!("amd-startup-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        AppPaths::from_data_dir(dir).unwrap()
    }

    /// Escenario del requisito "no borrar datos al actualizar":
    /// v1 crea datos → cierre → arranque con otra versión → datos intactos.
    #[test]
    fn update_keeps_existing_data() {
        let paths = temp_paths("update");
        let (conn, info) = init(&paths, "1.0.0");
        let conn = conn.unwrap();
        assert!(!info.updated);
        assert!(info.backup_file.is_none(), "base nueva: no hay nada que respaldar");
        for (name, nit) in [("Empresa A", "1"), ("Empresa B", "2")] {
            conn.execute(
                "INSERT INTO companies (razon_social, nit, created_at, updated_at) VALUES (?1, ?2, 'x', 'x')",
                [name, nit],
            )
            .unwrap();
        }
        for (name, tipo, unidad) in [("Concepto ICA", "ICA", "POR_MIL"), ("Concepto Retención", "RETEFUENTE", "PORCENTAJE")] {
            conn.execute(
                "INSERT INTO retention_concepts (nombre, tipo_retencion, unidad_tarifa, created_at, updated_at) VALUES (?1, ?2, ?3, 'x', 'x')",
                [name, tipo, unidad],
            )
            .unwrap();
        }
        drop(conn);

        let (conn, info) = init(&paths, "1.1.0");
        let conn = conn.unwrap();
        assert!(info.updated);
        assert_eq!(info.previous_version.as_deref(), Some("1.0.0"));
        let companies: i64 = conn.query_row("SELECT COUNT(*) FROM companies", [], |r| r.get(0)).unwrap();
        let concepts: i64 = conn.query_row("SELECT COUNT(*) FROM retention_concepts", [], |r| r.get(0)).unwrap();
        assert_eq!((companies, concepts), (2, 2));
        drop(conn);

        let (_, info) = init(&paths, "1.1.0");
        assert!(!info.updated, "el segundo arranque de la misma versión no es una actualización");
        std::fs::remove_dir_all(&paths.data_dir).unwrap();
    }

    /// Error corregido: la limpieza de logos borraba las firmas al reiniciar.
    #[test]
    fn signatures_survive_restart_and_cancelled_ones_are_cleaned() {
        let paths = temp_paths("signatures");
        let conn = init(&paths, "1.7.0").0.unwrap();
        let png = signatures::tests::png_1px();
        let saved = signatures::import_from_bytes(&paths.signatures_dir, &png).unwrap();
        let cancelled = signatures::import_from_bytes(&paths.signatures_dir, &png).unwrap();
        // Firmante de una versión anterior, con la firma dentro de logos/.
        let legacy = logos::import_from_bytes(&paths.logos_dir, "png", &png).unwrap();
        for file in [&saved, &legacy] {
            conn.execute(
                "INSERT INTO certificate_signers (name, role, professional_document, signature_file, created_at, updated_at)
                 VALUES ('Leidy', 'Contadora', 'TP-1', ?1, 'x', 'x')",
                [file],
            )
            .unwrap();
        }
        drop(conn);

        for _ in 0..2 {
            let conn = init(&paths, "1.7.1").0.unwrap();
            drop(conn);
            assert!(signatures::read_valid(&paths.signatures_dir, &saved).is_some());
            assert!(signatures::read_valid(&paths.signatures_dir, &legacy).is_some(), "firma antigua migrada");
            assert!(!paths.logos_dir.join(&legacy).exists());
            assert!(!signatures::is_available(&paths.signatures_dir, &cancelled));
        }
        std::fs::remove_dir_all(&paths.data_dir).unwrap();
    }
}
