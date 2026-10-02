use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{AppError, AppResult};
use crate::models::company::{Company, CompanyInput, Shareholder};
use crate::services::time::now_iso;

const COLUMNS: &str = "id, razon_social, nit, direccion, ciudad, telefono, correo, info_adicional, logo_file, dv, subscribed_total_shares, subscribed_nominal_value, paid_total_shares, paid_nominal_value, created_at, updated_at, ciiu_code";

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
        dv: r.get(9)?,
        subscribed_total_shares: r.get(10)?,
        subscribed_nominal_value: r.get(11)?,
        paid_total_shares: r.get(12)?,
        paid_nominal_value: r.get(13)?,
        ciiu_code: r.get(16)?,
        shareholders: Vec::new(),
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
    })
}

pub fn list(conn: &Connection, search: Option<&str>) -> AppResult<Vec<Company>> {
    let pattern = format!("%{}%", search.unwrap_or("").trim());
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM companies
         WHERE razon_social LIKE ?1 OR nit LIKE ?1 OR ciudad LIKE ?1
         ORDER BY razon_social COLLATE NOCASE"
    ))?;
    let mut rows = stmt.query_map([pattern], map)?.collect::<Result<Vec<_>, _>>()?;
    for c in &mut rows { c.shareholders = list_shareholders(conn, c.id)?; }
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Company> {
    let mut company = conn.query_row(&format!("SELECT {COLUMNS} FROM companies WHERE id = ?1"), [id], map)
        .optional()?
        .ok_or_else(|| AppError::user("La empresa no existe o fue eliminada."))?;
    company.shareholders = list_shareholders(conn, id)?;
    Ok(company)
}

fn list_shareholders(conn: &Connection, company_id: i64) -> AppResult<Vec<Shareholder>> {
    Ok(conn.prepare("SELECT id, name, identity_document, percentage, sort_order FROM shareholders WHERE company_id = ?1 ORDER BY sort_order, id")?
        .query_map([company_id], |r| Ok(Shareholder { id: Some(r.get(0)?), name: r.get(1)?, identity_document: r.get(2)?, percentage: r.get(3)?, sort_order: r.get(4)? }))?
        .collect::<Result<_, _>>()?)
}

fn replace_shareholders(conn: &Connection, company_id: i64, rows: &[Shareholder]) -> AppResult<()> {
    conn.execute("DELETE FROM shareholders WHERE company_id = ?1", [company_id])?;
    let now = now_iso();
    for s in rows {
        conn.execute("INSERT INTO shareholders (company_id, name, identity_document, percentage, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![company_id, s.name, s.identity_document, s.percentage, s.sort_order, now])?;
    }
    Ok(())
}

pub fn insert(conn: &Connection, c: &CompanyInput) -> AppResult<i64> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO companies (razon_social, nit, direccion, ciudad, telefono, correo, info_adicional, logo_file, dv, subscribed_total_shares, subscribed_nominal_value, paid_total_shares, paid_nominal_value, created_at, updated_at, ciiu_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15)",
        params![c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, c.dv, c.subscribed_total_shares, c.subscribed_nominal_value, c.paid_total_shares, c.paid_nominal_value, now, c.ciiu_code],
    )?;
    let id = conn.last_insert_rowid();
    replace_shareholders(conn, id, &c.shareholders)?;
    Ok(id)
}

/// Inserta conservando id y fechas (restauración de backups).
pub fn insert_full(conn: &Connection, c: &Company) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO companies ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)"),
        params![c.id, c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, c.dv, c.subscribed_total_shares, c.subscribed_nominal_value, c.paid_total_shares, c.paid_nominal_value, c.created_at, c.updated_at, c.ciiu_code],
    )?;
    replace_shareholders(conn, c.id, &c.shareholders)?;
    Ok(())
}

pub fn update(conn: &Connection, id: i64, c: &CompanyInput) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE companies SET razon_social = ?1, nit = ?2, direccion = ?3, ciudad = ?4, telefono = ?5,
                correo = ?6, info_adicional = ?7, logo_file = ?8, dv = ?9, subscribed_total_shares = ?10, subscribed_nominal_value = ?11, paid_total_shares = ?12, paid_nominal_value = ?13, updated_at = ?14, ciiu_code = ?16
         WHERE id = ?15",
        params![c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, c.dv, c.subscribed_total_shares, c.subscribed_nominal_value, c.paid_total_shares, c.paid_nominal_value, now_iso(), id, c.ciiu_code],
    )?;
    if n == 0 {
        return Err(AppError::user("La empresa no existe o fue eliminada."));
    }
    replace_shareholders(conn, id, &c.shareholders)?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM companies WHERE id = ?1", [id])?;
    Ok(())
}
