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

use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::services::time::now_iso;

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration { version: 1, name: "initial", sql: include_str!("../../migrations/001_initial.sql") },
    Migration { version: 2, name: "shareholder_certificates", sql: include_str!("../../migrations/002_shareholder_certificates.sql") },
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
        let tx = conn.transaction()?;
        let result = tx.execute_batch(m.sql).and_then(|_| {
            tx.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![m.version, m.name, now_iso()],
            )
        });
        match result {
            Ok(_) => tx.commit()?,
            Err(e) => {
                // El drop de `tx` sin commit hace ROLLBACK.
                eprintln!("[migrations] {:03}_{} falló: {e}", m.version, m.name);
                return Err(AppError::user(format!(
                    "No se pudo actualizar la base de datos (paso {:03}). Tus datos no se modificaron.",
                    m.version
                )));
            }
        }
        applied.push(format!("{:03}_{}", m.version, m.name));
    }
    Ok(applied)
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
            assert!(
                !sql.contains("DROP TABLE") && !sql.contains("DELETE FROM"),
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
        let bad = Migration { version: 999, name: "bad", sql: "CREATE TABLE ok_table(x); SELECT * FROM missing_table;" };
        let tx = conn.transaction().unwrap();
        assert!(tx.execute_batch(bad.sql).is_err());
        drop(tx);
        let exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'ok_table'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(exists, 0, "la parte aplicada se revierte");
    }
}
