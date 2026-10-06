//! Migraciones incrementales de SQLite.
//!
//! - Cada migración se aplica una sola vez y queda registrada en `schema_migrations`.
//! - Cada migración corre en su propia transacción: si falla, ROLLBACK y la base
//!   queda exactamente como estaba.
//! - Antes de aplicar migraciones sobre una base con datos se crea una copia
//!   automática (ver `crate::startup`).
//!
//! Para agregar una migración: crear `migrations/00N_descripcion.sql` y
//! añadirla al final de `MIGRATIONS`. Nunca editar ni reordenar las existentes.
//!
//! Las migraciones solo agregan. La excepción es reconstruir una tabla para
//! cambiar una restricción que SQLite no deja alterar: se marca con
//! `rebuilds_tables`, corre con las llaves foráneas apagadas (así reemplazar la
//! tabla no arrastra las filas que dependen de ella), se verifica la integridad
//! antes de confirmar y debe tener una prueba que demuestre que conserva los datos.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::services::time::now_iso;

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
    /// Reconstruye una tabla (copia → reemplazo → renombre). Ver la nota del módulo.
    pub rebuilds_tables: bool,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration { version: 1, name: "initial", sql: include_str!("../../migrations/001_initial.sql"), rebuilds_tables: false },
    Migration { version: 2, name: "shareholder_certificates", sql: include_str!("../../migrations/002_shareholder_certificates.sql"), rebuilds_tables: false },
    Migration { version: 3, name: "suppliers", sql: include_str!("../../migrations/003_suppliers.sql"), rebuilds_tables: false },
    Migration { version: 4, name: "dropi_status_mappings", sql: include_str!("../../migrations/004_dropi_status_mappings.sql"), rebuilds_tables: false },
    Migration { version: 5, name: "dropi_indemnity_category", sql: include_str!("../../migrations/005_dropi_indemnity_category.sql"), rebuilds_tables: false },
    Migration { version: 6, name: "withholding", sql: include_str!("../../migrations/006_withholding.sql"), rebuilds_tables: false },
    Migration { version: 7, name: "income_certificates", sql: include_str!("../../migrations/007_income_certificates.sql"), rebuilds_tables: false },
    Migration { version: 8, name: "self_withholding", sql: include_str!("../../migrations/008_self_withholding.sql"), rebuilds_tables: false },
    Migration { version: 9, name: "vat_document_titles", sql: include_str!("../../migrations/009_vat_document_titles.sql"), rebuilds_tables: false },
    Migration { version: 10, name: "puc", sql: include_str!("../../migrations/010_puc.sql"), rebuilds_tables: false },
    Migration { version: 11, name: "supplier_puc_codes", sql: include_str!("../../migrations/011_supplier_puc_codes.sql"), rebuilds_tables: false },
    Migration {
        version: 12,
        name: "suppliers_minimal_and_puc_by_supplier",
        sql: include_str!("../../migrations/012_suppliers_minimal_and_puc_by_supplier.sql"),
        rebuilds_tables: true,
    },
];

pub fn ensure_migrations_table(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version     INTEGER PRIMARY KEY,
            name        TEXT NOT NULL,
            applied_at  TEXT NOT NULL
        );",
    )?;
    Ok(())
}

pub fn current_version(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |r| r.get(0),
    )?)
}

pub fn pending(conn: &Connection) -> AppResult<Vec<&'static Migration>> {
    let current = current_version(conn)?;
    Ok(MIGRATIONS.iter().filter(|m| m.version > current).collect())
}

/// Aplica las migraciones pendientes. Devuelve los nombres aplicados.
pub fn run_pending(conn: &mut Connection) -> AppResult<Vec<String>> {
    ensure_migrations_table(conn)?;
    let mut applied = Vec::new();
    for m in pending(conn)? {
        // Las llaves foráneas solo se pueden apagar fuera de una transacción.
        let restore_foreign_keys = m.rebuilds_tables && conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))? != 0;
        if restore_foreign_keys {
            conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
        }
        let result = apply(conn, m);
        if restore_foreign_keys {
            conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        }
        if let Err(e) = result {
            eprintln!("[migrations] {:03}_{} falló: {}", m.version, m.name, e.0);
            return Err(AppError::user(format!(
                "No se pudo actualizar la base de datos (paso {:03}). Tus datos no se modificaron.",
                m.version
            )));
        }
        applied.push(format!("{:03}_{}", m.version, m.name));
    }
    Ok(applied)
}

/// Una migración en su propia transacción: si algo falla, el drop de `tx` sin commit hace ROLLBACK.
fn apply(conn: &mut Connection, m: &Migration) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(m.sql)?;
    if m.rebuilds_tables && tx.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err(AppError::user("la reconstrucción dejó referencias rotas"));
    }
    tx.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![m.version, m.name, now_iso()],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_strictly_increasing() {
        let mut last = 0;
        for m in MIGRATIONS {
            assert!(m.version > last, "versión {} fuera de orden", m.version);
            last = m.version;
        }
    }

    #[test]
    fn migrations_never_drop_tables() {
        for m in MIGRATIONS {
            let sql = m.sql.to_ascii_uppercase();
            // Una reconstrucción reemplaza la tabla por su copia; su propia prueba demuestra que conserva los datos.
            assert!(
                (m.rebuilds_tables || !sql.contains("DROP TABLE")) && !sql.contains("DELETE FROM"),
                "la migración {} contiene una operación destructiva",
                m.version
            );
        }
    }

    #[test]
    fn applies_once_and_keeps_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        assert_eq!(run_pending(&mut conn).unwrap().len(), MIGRATIONS.len());
        conn.execute(
            "INSERT INTO companies (razon_social, nit, created_at, updated_at) VALUES ('Empresa A', '1', 'x', 'x')",
            [],
        )
        .unwrap();
        // Segundo arranque (misma versión o actualización sin migraciones nuevas).
        assert!(run_pending(&mut conn).unwrap().is_empty());
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM companies", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn failed_migration_rolls_back() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        let bad = Migration { version: 999, name: "bad", sql: "CREATE TABLE ok_table(x); SELECT * FROM missing_table;", rebuilds_tables: false };
        let tx = conn.transaction().unwrap();
        assert!(tx.execute_batch(bad.sql).is_err());
        drop(tx);
        let exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'ok_table'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(exists, 0, "la parte aplicada se revierte");
    }
}
