//! Reinicio total de los datos de la aplicación («Zona de peligro»).
//!
//! Qué hace, en este orden:
//! 1. Exige la frase exacta `REINICIAR DATOS` y la segunda confirmación (la UI las pide, pero esta es la última barrera).
//! 2. Crea una instantánea SQLite recuperable (`database-reset-before-…`) en la carpeta de copias. No es un dato activo:
//!    la app no la muestra ni la restaura sola.
//! 3. Construye en memoria una base NUEVA con todas las migraciones (la línea base de una instalación limpia: catálogos
//!    del sistema, tablas oficiales, líneas y secciones de Estados Financieros, configuraciones base) y, en UNA transacción,
//!    vacía cada tabla de la base real y copia esa línea base. Así nada del usuario sobrevive —empresas, socios, terceros,
//!    firmas, PUC personalizados, clasificaciones, movimientos, nómina, obligaciones, Exógena…— y los catálogos del sistema
//!    vuelven exactamente a como los entrega la versión instalada, sin una lista de tablas que mantener a mano.
//! 4. Solo si la transacción se confirmó, borra los archivos persistentes (uno por uno: nunca la carpeta de datos completa).
//!
//! No toca el código, las migraciones aplicadas (`schema_migrations`), la base en sí ni la carpeta de copias.

use std::path::Path;

use rusqlite::types::Value;
use rusqlite::Connection;
use serde::Serialize;

use crate::database::{self, migrations};
use crate::error::{AppError, AppResult};
use crate::services::backups;
use crate::services::paths::AppPaths;
use crate::startup::LAST_RUN_VERSION_KEY;

/// Frase que el usuario debe escribir exactamente.
pub const RESET_PHRASE: &str = "REINICIAR DATOS";
/// Prefijo inequívoco de la instantánea previa al reinicio (no coincide con los prefijos que limpia `backups::prune`).
pub const PREFIX_BEFORE_RESET: &str = "database-reset-before-";

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResetOutcome {
    /// Nombre (no ruta) de la instantánea creada antes de vaciar.
    pub snapshot_file: String,
    pub removed_files: usize,
    /// Archivos que no se pudieron borrar (los datos de la base ya se reiniciaron).
    pub warnings: Vec<String>,
}

fn user_tables(conn: &Connection) -> AppResult<Vec<String>> {
    Ok(conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?)
}

fn has_table(conn: &Connection, name: &str) -> AppResult<bool> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)", [name], |r| r.get(0))?)
}

fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

/// Copia todas las filas de `table` de `source` a `target` (por nombre de columna, no por posición).
fn copy_table(source: &Connection, target: &Connection, table: &str) -> AppResult<()> {
    let mut select = source.prepare(&format!("SELECT * FROM {}", quote(table)))?;
    let columns: Vec<String> = select.column_names().iter().map(|c| c.to_string()).collect();
    if columns.is_empty() {
        return Ok(());
    }
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quote(table),
        columns.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", "),
        vec!["?"; columns.len()].join(", ")
    );
    let mut insert = target.prepare(&sql)?;
    let mut rows = select.query([])?;
    while let Some(row) = rows.next()? {
        let values: Vec<Value> = (0..columns.len()).map(|i| row.get::<_, Value>(i)).collect::<Result<_, _>>()?;
        insert.execute(rusqlite::params_from_iter(values))?;
    }
    Ok(())
}

/// Vacía la base real y deja la línea base de una instalación limpia. Todo o nada.
fn reset_database(conn: &mut Connection, current_version: &str) -> AppResult<()> {
    let mut baseline = Connection::open_in_memory()?;
    migrations::run_pending(&mut baseline)?;
    let baseline_tables = user_tables(&baseline)?;

    // Las llaves foráneas se apagan solo durante el reemplazo (no se pueden cambiar dentro de una transacción) y se
    // verifican antes de confirmar: si algo quedara roto, la transacción se revierte y no se pierde nada.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let result = (|| -> AppResult<()> {
        let tx = conn.transaction()?;
        for table in user_tables(&tx)? {
            tx.execute(&format!("DELETE FROM {}", quote(&table)), [])?;
        }
        if has_table(&tx, "sqlite_sequence")? {
            tx.execute("DELETE FROM sqlite_sequence", [])?;
        }
        for table in &baseline_tables {
            if has_table(&tx, table)? {
                copy_table(&baseline, &tx, table)?;
            }
        }
        if has_table(&baseline, "sqlite_sequence")? && has_table(&tx, "sqlite_sequence")? {
            copy_table(&baseline, &tx, "sqlite_sequence")?;
        }
        database::set_setting(&tx, LAST_RUN_VERSION_KEY, current_version)?;
        if tx.prepare("PRAGMA foreign_key_check")?.exists([])? {
            return Err(AppError::user("El reinicio dejó referencias rotas y se canceló. Tus datos no se modificaron."));
        }
        tx.commit()?;
        Ok(())
    })();
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    result
}

/// Borra los archivos regulares de un directorio, uno por uno. No entra en subcarpetas ni borra el directorio.
fn clear_files(dir: &Path, removed: &mut usize, warnings: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let is_file = std::fs::symlink_metadata(&path).map(|m| m.is_file() || m.file_type().is_symlink()).unwrap_or(false);
        if !is_file {
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(()) => *removed += 1,
            Err(e) => {
                eprintln!("[reset] no se pudo borrar {}: {e}", path.display());
                warnings.push(path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
            }
        }
    }
}

pub fn reset_data(conn: &mut Connection, paths: &AppPaths, current_version: &str, phrase: &str, final_confirmation: bool) -> AppResult<ResetOutcome> {
    if phrase != RESET_PHRASE {
        return Err(AppError::user(format!("Escribe exactamente «{RESET_PHRASE}» para confirmar.")));
    }
    if !final_confirmation {
        return Err(AppError::user("Falta la segunda confirmación del reinicio."));
    }
    let snapshot = backups::snapshot(conn, &paths.backups_dir, PREFIX_BEFORE_RESET, current_version)
        .map_err(|_| AppError::user("No se pudo crear la copia de seguridad previa. No se borró nada."))?;

    reset_database(conn, current_version)?;
    // Libera las páginas de los datos borrados: no queda información recuperable dentro del archivo activo.
    if let Err(e) = conn.execute_batch("VACUUM") {
        eprintln!("[reset] VACUUM: {e}");
    }

    let mut removed = 0;
    let mut warnings = Vec::new();
    for dir in paths.persistent_file_dirs() {
        clear_files(dir, &mut removed, &mut warnings);
    }
    Ok(ResetOutcome {
        snapshot_file: snapshot.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        removed_files: removed,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::{company_documents, logos, signatures};
    use crate::startup;

    fn temp_paths(tag: &str) -> AppPaths {
        let dir = std::env::temp_dir().join(format!("amd-reset-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        AppPaths::from_data_dir(dir).unwrap()
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    /// Foto de las tablas de sistema para compararla antes/después: todas las tablas con datos en una base limpia.
    fn baseline_digest(conn: &Connection) -> Vec<(String, i64)> {
        user_tables(conn).unwrap().into_iter().map(|t| (t.clone(), count(conn, &format!("SELECT COUNT(*) FROM {}", quote(&t))))).collect()
    }

    /// Ensucia la base como lo haría el uso real: datos de todo tipo + cambios sobre las tablas de sistema.
    fn dirty(conn: &Connection, paths: &AppPaths) {
        let png = signatures::tests::png_1px();
        let logo = logos::import_from_bytes(&paths.logos_dir, "png", &png).unwrap();
        let signature = signatures::import_from_bytes(&paths.signatures_dir, &png).unwrap();
        let rut = company_documents::import_from_bytes(&paths.company_documents_dir, b"%PDF-1.4 test").unwrap();
        conn.execute("INSERT INTO companies (id, razon_social, nit, logo_file, created_at, updated_at) VALUES (1, 'EMPRESA', '900', ?1, 'x', 'x')", [&logo]).unwrap();
        conn.execute("INSERT INTO shareholders (id, company_id, name, identity_document, percentage, sort_order, created_at, updated_at) VALUES (1, 1, 'ANA', 'CC 1', 100, 0, 'x', 'x')", []).unwrap();
        conn.execute("INSERT INTO shareholder_documents (shareholder_id, file_name, stored_file, size_bytes, uploaded_at) VALUES (1, 'rut.pdf', ?1, 13, 'x')", [&rut]).unwrap();
        conn.execute("INSERT INTO company_documents (company_id, kind, file_name, stored_file, size_bytes, uploaded_at) VALUES (1, 'rut', 'rut.pdf', 'x.pdf', 5, 'x')", []).unwrap();
        conn.execute("INSERT INTO suppliers (id, nit, business_name, created_at, updated_at) VALUES (1, '800197268', 'DIAN', 'x', 'x')", []).unwrap();
        conn.execute("INSERT INTO certificate_signers (name, role, professional_document, signature_file, created_at, updated_at) VALUES ('LEIDY', 'Contadora', 'TP', ?1, 'x', 'x')", [&signature]).unwrap();
        conn.execute("INSERT INTO exo_records (company_id, year, format_code, source_key, origin, created_at, updated_at) VALUES (1, 2025, '1010', 'shareholder:1', 'empresas', 'x', 'x')", []).unwrap();
        conn.execute("INSERT INTO exo_format_status (company_id, year, format_code, status, updated_at) VALUES (1, 2025, '1010', 'listo', 'x')", []).unwrap();
        // Clasificación persistente de Estados Financieros: asignaciones, historial, líneas creadas y renombradas, PUC personalizados.
        conn.execute("UPDATE fs_lines SET name = 'Renombrada por el usuario' WHERE id = 5", []).unwrap();
        conn.execute("INSERT INTO fs_lines (section, name, sort_order, created_at, updated_at) VALUES ('income', 'Línea propia', 9, 'x', 'x')", []).unwrap();
        conn.execute("INSERT INTO fs_puc_mappings (puc_code, line_id, excluded, updated_at) VALUES ('233525', 6, 0, 'x')", []).unwrap();
        conn.execute("INSERT INTO fs_puc_mapping_history (puc_code, new_excluded, changed_at) VALUES ('233525', 0, 'x')", []).unwrap();
        conn.execute("DELETE FROM fs_puc_mappings WHERE puc_code = '7305'", []).unwrap();
        conn.execute("INSERT INTO puc_custom_codes (code, concept, parent_code, created_at, updated_at) VALUES ('2335991', 'PROPIO', '2335', 'x', 'x')", []).unwrap();
        conn.execute("UPDATE exo_departments SET name = 'Cambiado' WHERE code = '76'", []).unwrap();
        conn.execute("INSERT INTO exo_municipalities (dept_code, code, name, updated_at) VALUES ('76', '999', 'Propio', 'x')", []).unwrap();
        conn.execute("DELETE FROM withholding_rates", []).unwrap();
        conn.execute("INSERT INTO settings (key, value) VALUES ('algo', 'x')", []).unwrap();
        conn.execute("INSERT INTO retention_concepts (nombre, tipo_retencion, unidad_tarifa, created_at, updated_at) VALUES ('C', 'RETEFUENTE', 'PORCENTAJE', 'x', 'x')", []).unwrap();
        conn.execute("UPDATE fs_sections SET representative_line_id = 6 WHERE section = 'liability_current'", []).unwrap();
    }

    #[test]
    fn reset_wipes_user_data_restores_system_baseline_and_removes_files() {
        let paths = temp_paths("full");
        let (conn, _) = startup::init(&paths, "1.40.0");
        let mut conn = conn.unwrap();
        let clean = baseline_digest(&conn);
        let migrations_before: Vec<(i64, String)> = conn.prepare("SELECT version, name FROM schema_migrations ORDER BY version").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
        dirty(&conn, &paths);
        assert_ne!(baseline_digest(&conn), clean);

        let outcome = reset_data(&mut conn, &paths, "1.40.0", RESET_PHRASE, true).unwrap();

        // 1. La base queda exactamente como una instalación limpia (mismas tablas y cantidades de filas de sistema).
        assert_eq!(baseline_digest(&conn), clean);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM companies"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM shareholders"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM suppliers"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM certificate_signers"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM exo_records"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM retention_concepts"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM settings WHERE key = 'algo'"), 0);
        // 2. Clasificación de Estados Financieros: nada de lo del usuario sobrevive y lo base vuelve.
        assert_eq!(conn.query_row("SELECT name FROM fs_lines WHERE id = 5", [], |r| r.get::<_, String>(0)).unwrap(), "Proveedores");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM fs_lines WHERE name = 'Línea propia'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM fs_puc_mappings WHERE puc_code = '233525'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM fs_puc_mapping_history"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM fs_puc_mappings WHERE puc_code = '7305' AND excluded = 1"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM puc_custom_codes WHERE code = '2335991'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM puc_custom_codes WHERE code = '7305'"), 1);
        assert_eq!(count(&conn, "SELECT representative_line_id FROM fs_sections WHERE section = 'liability_current'"), 6);
        // 3. Catálogos del sistema (retenciones, Exógena) vuelven a la línea base.
        assert!(count(&conn, "SELECT COUNT(*) FROM withholding_rates") > 0);
        assert_eq!(conn.query_row("SELECT name FROM exo_departments WHERE code = '76'", [], |r| r.get::<_, String>(0)).unwrap(), "Valle del Cauca");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM exo_municipalities WHERE name = 'Propio'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM exo_municipalities"), 1122);
        // 4. Las migraciones aplicadas y la versión de arranque se conservan; las llaves foráneas siguen activas y sanas.
        let migrations_after: Vec<(i64, String)> = conn.prepare("SELECT version, name FROM schema_migrations ORDER BY version").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(migrations_after, migrations_before);
        assert_eq!(database::get_setting(&conn, LAST_RUN_VERSION_KEY).unwrap().as_deref(), Some("1.40.0"));
        assert_eq!(count(&conn, "PRAGMA foreign_keys"), 1);
        assert!(!conn.prepare("PRAGMA foreign_key_check").unwrap().exists([]).unwrap());
        // 5. Archivos persistentes borrados (logo, firma y RUT del socio); las carpetas siguen existiendo.
        assert_eq!(outcome.removed_files, 3);
        assert!(outcome.warnings.is_empty());
        for dir in [&paths.logos_dir, &paths.signatures_dir, &paths.company_documents_dir] {
            assert!(dir.is_dir());
            assert_eq!(std::fs::read_dir(dir).unwrap().count(), 0);
        }
        // 6. La instantánea previa existe, es una base SQLite recuperable con los datos de antes y no es un dato activo.
        let snapshot = paths.backups_dir.join(&outcome.snapshot_file);
        assert!(outcome.snapshot_file.starts_with(PREFIX_BEFORE_RESET));
        let old = Connection::open(&snapshot).unwrap();
        assert_eq!(count(&old, "SELECT COUNT(*) FROM companies"), 1);
        assert_eq!(count(&old, "SELECT COUNT(*) FROM suppliers"), 1);
        assert!(paths.db_file.is_file());
        // 7. La base vuelve a funcionar para datos nuevos (los ids reinician como en una instalación limpia).
        conn.execute("INSERT INTO companies (razon_social, nit, created_at, updated_at) VALUES ('NUEVA', '1', 'x', 'x')", []).unwrap();
        assert_eq!(count(&conn, "SELECT id FROM companies"), 1);
        std::fs::remove_dir_all(&paths.data_dir).unwrap();
    }

    #[test]
    fn wrong_phrase_or_missing_second_confirmation_changes_nothing() {
        let paths = temp_paths("guard");
        let mut conn = startup::init(&paths, "1.40.0").0.unwrap();
        dirty(&conn, &paths);
        for (phrase, confirmed) in [("reiniciar datos", true), ("REINICIAR DATOS ", true), ("", true), (RESET_PHRASE, false)] {
            assert!(reset_data(&mut conn, &paths, "1.40.0", phrase, confirmed).is_err(), "{phrase:?}/{confirmed}");
        }
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM companies"), 1);
        assert_eq!(std::fs::read_dir(&paths.logos_dir).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(&paths.backups_dir).unwrap().count(), 0, "sin confirmación no se crea ni una copia");
        std::fs::remove_dir_all(&paths.data_dir).unwrap();
    }

    #[test]
    fn a_failed_reset_rolls_back_and_keeps_files() {
        let paths = temp_paths("rollback");
        let mut conn = startup::init(&paths, "1.40.0").0.unwrap();
        dirty(&conn, &paths);
        // Un fallo a mitad del reemplazo (aquí, un trigger que rechaza la copia de la línea base) revierte TODO.
        conn.execute_batch("CREATE TRIGGER boom BEFORE INSERT ON fs_sections BEGIN SELECT RAISE(ABORT, 'boom'); END;").unwrap();
        assert!(reset_data(&mut conn, &paths, "1.40.0", RESET_PHRASE, true).is_err());
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM companies"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM suppliers"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM fs_lines WHERE name = 'Línea propia'"), 1);
        assert_eq!(count(&conn, "PRAGMA foreign_keys"), 1, "las llaves foráneas se reactivan aunque falle");
        // Los archivos solo se borran cuando la base ya se reinició.
        assert_eq!(std::fs::read_dir(&paths.logos_dir).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(&paths.signatures_dir).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(&paths.company_documents_dir).unwrap().count(), 1);
        std::fs::remove_dir_all(&paths.data_dir).unwrap();
    }
}
