//! Notas Financieras guardadas por empresa y período (el mismo de los Estados Financieros).
//!
//! `data` es el contenido editable (ente económico, objeto social, notas específicas) y `company_snapshot` la instantánea de
//! los datos de Empresas tomada al guardar / generar, para que un PDF histórico se pueda reproducir. Ambos son JSON opacos
//! para Rust: la estructura la define el frontend (`modules/financial-statements/notes`).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::services::time::now_iso;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FsNotes {
    pub id: i64,
    pub company_id: i64,
    pub period_start: String,
    pub period_end: String,
    pub data: Value,
    pub company_snapshot: Value,
    pub generated_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsNotesInput {
    pub company_id: i64,
    pub period_start: String,
    pub period_end: String,
    pub data: Value,
    pub company_snapshot: Value,
    /// El usuario generó el PDF con esta versión: se registra la fecha.
    #[serde(default)]
    pub generated: bool,
}

const MAX_JSON_BYTES: usize = 2_000_000;

fn valid_date(v: &str) -> bool {
    let p: Vec<&str> = v.split('-').collect();
    p.len() == 3 && p[0].len() == 4 && p[1].len() == 2 && p[2].len() == 2 && p.iter().all(|x| x.chars().all(|c| c.is_ascii_digit()))
}

pub fn get(conn: &Connection, company_id: i64, start: &str, end: &str) -> AppResult<Option<FsNotes>> {
    Ok(conn
        .query_row(
            "SELECT id, company_id, period_start, period_end, data, company_snapshot, generated_at, updated_at FROM fs_notes WHERE company_id = ?1 AND period_start = ?2 AND period_end = ?3",
            params![company_id, start, end],
            |r| {
                Ok(FsNotes {
                    id: r.get(0)?,
                    company_id: r.get(1)?,
                    period_start: r.get(2)?,
                    period_end: r.get(3)?,
                    data: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or(Value::Null),
                    company_snapshot: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or(Value::Null),
                    generated_at: r.get(6)?,
                    updated_at: r.get(7)?,
                })
            },
        )
        .optional()?)
}

pub fn save(conn: &Connection, input: &FsNotesInput) -> AppResult<FsNotes> {
    if !valid_date(&input.period_start) || !valid_date(&input.period_end) || input.period_start > input.period_end {
        return Err(AppError::user("El período de las notas no es válido."));
    }
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)", [input.company_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::user("La empresa no existe o fue eliminada."));
    }
    let data = serde_json::to_string(&input.data).map_err(|_| AppError::user("No se pudieron guardar las notas."))?;
    let snapshot = serde_json::to_string(&input.company_snapshot).map_err(|_| AppError::user("No se pudieron guardar las notas."))?;
    if data.len() > MAX_JSON_BYTES || snapshot.len() > MAX_JSON_BYTES {
        return Err(AppError::user("Las notas superan el tamaño permitido."));
    }
    let now = now_iso();
    conn.execute(
        "INSERT INTO fs_notes (company_id, period_start, period_end, data, company_snapshot, generated_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT (company_id, period_start, period_end) DO UPDATE SET
            data = excluded.data, company_snapshot = excluded.company_snapshot,
            generated_at = COALESCE(?6, fs_notes.generated_at), updated_at = excluded.updated_at",
        params![input.company_id, input.period_start, input.period_end, data, snapshot, if input.generated { Some(now.clone()) } else { None }, now],
    )?;
    get(conn, input.company_id, &input.period_start, &input.period_end)?.ok_or_else(|| AppError::user("No se pudieron guardar las notas."))
}

pub fn delete(conn: &Connection, company_id: i64, start: &str, end: &str) -> AppResult<()> {
    conn.execute("DELETE FROM fs_notes WHERE company_id = ?1 AND period_start = ?2 AND period_end = ?3", params![company_id, start, end])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations;
    use serde_json::json;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::run_pending(&mut c).unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        c.execute("INSERT INTO companies (id, razon_social, nit, created_at, updated_at) VALUES (1, 'A', '1', 'x', 'x'), (2, 'B', '2', 'x', 'x')", []).unwrap();
        c
    }

    fn input(company: i64, start: &str, end: &str, text: &str, generated: bool) -> FsNotesInput {
        FsNotesInput { company_id: company, period_start: start.into(), period_end: end.into(), data: json!({"entity": text}), company_snapshot: json!({"razonSocial": "A"}), generated }
    }

    #[test]
    fn notes_persist_per_company_and_period_and_never_mix() {
        let c = db();
        save(&c, &input(1, "2026-01-01", "2026-08-31", "uno", false)).unwrap();
        save(&c, &input(1, "2026-01-01", "2026-12-31", "dos", false)).unwrap();
        save(&c, &input(2, "2026-01-01", "2026-08-31", "tres", false)).unwrap();
        assert_eq!(get(&c, 1, "2026-01-01", "2026-08-31").unwrap().unwrap().data["entity"], "uno");
        assert_eq!(get(&c, 1, "2026-01-01", "2026-12-31").unwrap().unwrap().data["entity"], "dos");
        assert_eq!(get(&c, 2, "2026-01-01", "2026-08-31").unwrap().unwrap().data["entity"], "tres");
        assert!(get(&c, 2, "2026-01-01", "2026-12-31").unwrap().is_none());
    }

    #[test]
    fn saving_again_updates_in_place_and_keeps_the_generation_date() {
        let c = db();
        let first = save(&c, &input(1, "2026-01-01", "2026-08-31", "uno", true)).unwrap();
        assert!(first.generated_at.is_some());
        let second = save(&c, &input(1, "2026-01-01", "2026-08-31", "editado", false)).unwrap();
        assert_eq!(second.id, first.id);
        assert_eq!(second.data["entity"], "editado");
        assert_eq!(second.generated_at, first.generated_at);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM fs_notes", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }

    #[test]
    fn invalid_periods_and_missing_companies_are_rejected_and_notes_cascade_with_the_company() {
        let c = db();
        assert!(save(&c, &input(1, "2026-09-01", "2026-08-31", "x", false)).is_err());
        assert!(save(&c, &input(1, "ayer", "hoy", "x", false)).is_err());
        assert!(save(&c, &input(99, "2026-01-01", "2026-08-31", "x", false)).is_err());
        save(&c, &input(1, "2026-01-01", "2026-08-31", "uno", false)).unwrap();
        c.execute("DELETE FROM companies WHERE id = 1", []).unwrap();
        assert!(get(&c, 1, "2026-01-01", "2026-08-31").unwrap().is_none());
    }
}
