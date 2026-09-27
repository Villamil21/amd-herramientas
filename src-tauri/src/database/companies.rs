use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{AppError, AppResult};
use crate::models::company::{Company, CompanyInput};
use crate::services::time::now_iso;

const COLUMNS: &str = "id, razon_social, nit, direccion, ciudad, telefono, correo, info_adicional, logo_file, created_at, updated_at";

fn map(r: &Row) -> rusqlite::Result<Company> {
    Ok(Company {
        id: r.get(0)?,
        razon_social: r.get(1)?,
        nit: r.get(2)?,
        direccion: r.get(3)?,
        ciudad: r.get(4)?,
        telefono: r.get(5)?,
        correo: r.get(6)?,
        info_adicional: r.get(7)?,
        logo_file: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

pub fn list(conn: &Connection, search: Option<&str>) -> AppResult<Vec<Company>> {
    let pattern = format!("%{}%", search.unwrap_or("").trim());
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM companies
         WHERE razon_social LIKE ?1 OR nit LIKE ?1 OR ciudad LIKE ?1
         ORDER BY razon_social COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([pattern], map)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Company> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM companies WHERE id = ?1"), [id], map)
        .optional()?
        .ok_or_else(|| AppError::user("La empresa no existe o fue eliminada."))
}

pub fn insert(conn: &Connection, c: &CompanyInput) -> AppResult<i64> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO companies (razon_social, nit, direccion, ciudad, telefono, correo, info_adicional, logo_file, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Inserta conservando id y fechas (restauración de backups).
pub fn insert_full(conn: &Connection, c: &Company) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO companies ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"),
        params![c.id, c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, c.created_at, c.updated_at],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, id: i64, c: &CompanyInput) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE companies SET razon_social = ?1, nit = ?2, direccion = ?3, ciudad = ?4, telefono = ?5,
                correo = ?6, info_adicional = ?7, logo_file = ?8, updated_at = ?9
         WHERE id = ?10",
        params![c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, now_iso(), id],
    )?;
    if n == 0 {
        return Err(AppError::user("La empresa no existe o fue eliminada."));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM companies WHERE id = ?1", [id])?;
    Ok(())
}
