use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{AppError, AppResult};
use crate::database::company_documents;
use crate::models::company::{Company, CompanyInput, Shareholder};
use crate::services::time::now_iso;

const COLUMNS: &str = "id, razon_social, nit, direccion, ciudad, telefono, correo, info_adicional, logo_file, dv, subscribed_total_shares, subscribed_nominal_value, paid_total_shares, paid_nominal_value, created_at, updated_at, ciiu_code, legal_rep_name, legal_rep_document, legal_rep_alt_name, legal_rep_alt_document, legal_rep_manual, legal_rep_alt_manual";

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
        legal_rep_name: r.get(17)?,
        legal_rep_document: r.get(18)?,
        legal_rep_alt_name: r.get(19)?,
        legal_rep_alt_document: r.get(20)?,
        legal_rep_manual: r.get::<_, i64>(21)? != 0,
        legal_rep_alt_manual: r.get::<_, i64>(22)? != 0,
        shareholders: Vec::new(),
        documents: Vec::new(),
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
    for c in &mut rows {
        c.shareholders = list_shareholders(conn, c.id)?;
        c.documents = company_documents::list(conn, c.id)?;
    }
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Company> {
    let mut company = conn.query_row(&format!("SELECT {COLUMNS} FROM companies WHERE id = ?1"), [id], map)
        .optional()?
        .ok_or_else(|| AppError::user("La empresa no existe o fue eliminada."))?;
    company.shareholders = list_shareholders(conn, id)?;
    company.documents = company_documents::list(conn, id)?;
    Ok(company)
}

fn list_shareholders(conn: &Connection, company_id: i64) -> AppResult<Vec<Shareholder>> {
    Ok(conn.prepare("SELECT id, name, identity_document, percentage, sort_order, legal_role FROM shareholders WHERE company_id = ?1 ORDER BY sort_order, id")?
        .query_map([company_id], |r| Ok(Shareholder { id: Some(r.get(0)?), name: r.get(1)?, identity_document: r.get(2)?, percentage: r.get(3)?, sort_order: r.get(4)?, legal_role: r.get(5)? }))?
        .collect::<Result<_, _>>()?)
}

fn replace_shareholders(conn: &Connection, company_id: i64, rows: &[Shareholder]) -> AppResult<()> {
    conn.execute("DELETE FROM shareholders WHERE company_id = ?1", [company_id])?;
    let now = now_iso();
    for s in rows {
        conn.execute("INSERT INTO shareholders (company_id, name, identity_document, percentage, sort_order, legal_role, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![company_id, s.name, s.identity_document, s.percentage, s.sort_order, s.legal_role, now])?;
    }
    Ok(())
}

pub fn insert(conn: &Connection, c: &CompanyInput) -> AppResult<i64> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO companies (razon_social, nit, direccion, ciudad, telefono, correo, info_adicional, logo_file, dv, subscribed_total_shares, subscribed_nominal_value, paid_total_shares, paid_nominal_value, created_at, updated_at, ciiu_code, legal_rep_name, legal_rep_document, legal_rep_alt_name, legal_rep_alt_document, legal_rep_manual, legal_rep_alt_manual)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
        params![c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, c.dv, c.subscribed_total_shares, c.subscribed_nominal_value, c.paid_total_shares, c.paid_nominal_value, now, c.ciiu_code, c.legal_rep_name, c.legal_rep_document, c.legal_rep_alt_name, c.legal_rep_alt_document, c.legal_rep_manual, c.legal_rep_alt_manual],
    )?;
    let id = conn.last_insert_rowid();
    replace_shareholders(conn, id, &c.shareholders)?;
    Ok(id)
}

/// Inserta conservando id y fechas (restauración de backups).
pub fn insert_full(conn: &Connection, c: &Company) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO companies ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)"),
        params![c.id, c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, c.dv, c.subscribed_total_shares, c.subscribed_nominal_value, c.paid_total_shares, c.paid_nominal_value, c.created_at, c.updated_at, c.ciiu_code, c.legal_rep_name, c.legal_rep_document, c.legal_rep_alt_name, c.legal_rep_alt_document, c.legal_rep_manual, c.legal_rep_alt_manual],
    )?;
    replace_shareholders(conn, c.id, &c.shareholders)?;
    Ok(())
}

pub fn update(conn: &Connection, id: i64, c: &CompanyInput) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE companies SET razon_social = ?1, nit = ?2, direccion = ?3, ciudad = ?4, telefono = ?5,
                correo = ?6, info_adicional = ?7, logo_file = ?8, dv = ?9, subscribed_total_shares = ?10, subscribed_nominal_value = ?11, paid_total_shares = ?12, paid_nominal_value = ?13, updated_at = ?14, ciiu_code = ?16, legal_rep_name = ?17, legal_rep_document = ?18, legal_rep_alt_name = ?19, legal_rep_alt_document = ?20, legal_rep_manual = ?21, legal_rep_alt_manual = ?22
         WHERE id = ?15",
        params![c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, c.dv, c.subscribed_total_shares, c.subscribed_nominal_value, c.paid_total_shares, c.paid_nominal_value, now_iso(), id, c.ciiu_code, c.legal_rep_name, c.legal_rep_document, c.legal_rep_alt_name, c.legal_rep_alt_document, c.legal_rep_manual, c.legal_rep_alt_manual],
    )?;
    if n == 0 {
        return Err(AppError::user("La empresa no existe o fue eliminada."));
    }
    replace_shareholders(conn, id, &c.shareholders)?;
    Ok(())
}

/// Empresas guardadas antes de los vínculos de representación legal: el principal se vincula con el socio
/// de igual documento; si no coincide queda como excepción explícita (así siguen editables sin perder el dato).
/// Es idempotente: solo toca empresas con representante, sin vínculo ni excepción.
pub fn link_legacy_representatives(conn: &Connection) -> AppResult<()> {
    let pending: Vec<(i64, String)> = conn
        .prepare("SELECT id, legal_rep_document FROM companies WHERE legal_rep_name <> '' AND legal_rep_manual = 0 AND NOT EXISTS (SELECT 1 FROM shareholders s WHERE s.company_id = companies.id AND s.legal_role = 'principal')")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (company_id, document) in pending {
        let key = crate::models::normalize::digits(&document);
        let matched = if key.is_empty() { None } else { list_shareholders(conn, company_id)?.into_iter().find(|s| crate::models::normalize::digits(&s.identity_document) == key).and_then(|s| s.id) };
        match matched {
            Some(shareholder_id) => conn.execute("UPDATE shareholders SET legal_role = 'principal' WHERE id = ?1", [shareholder_id])?,
            None => conn.execute("UPDATE companies SET legal_rep_manual = 1 WHERE id = ?1", [company_id])?,
        };
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    // Los movimientos contables nunca se borran sin trazabilidad: una empresa con información financiera se conserva.
    let used: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM fs_batches WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_employees WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_periods WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_opening_drafts WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_bank_accounts WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_tax_returns WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_tax_empty_periods WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_tax_company_settings WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_bank_account_lifecycle WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_bank_account_events WHERE company_id = ?1)", [id], |r| r.get(0))?;
    if used {
        return Err(AppError::user("La empresa tiene información en Estados Financieros (movimientos, nómina o periodos) y no se puede eliminar."));
    }
    conn.execute("DELETE FROM companies WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    #[test]
    fn legacy_representatives_are_linked_or_marked_as_exception() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        for (id, rep_name, rep_doc) in [(1, "Ana", "CC 1.020"), (2, "Pedro", "CC 99")] {
            conn.execute("INSERT INTO companies (id, razon_social, nit, created_at, updated_at, legal_rep_name, legal_rep_document) VALUES (?1, 'E', ?2, 'x', 'x', ?3, ?4)", params![id, format!("9{id}"), rep_name, rep_doc]).unwrap();
            conn.execute("INSERT INTO shareholders (company_id, name, identity_document, percentage, sort_order, created_at, updated_at) VALUES (?1, 'ANA', 'CC 1020', 100, 0, 'x', 'x')", [id]).unwrap();
        }
        link_legacy_representatives(&conn).unwrap();
        link_legacy_representatives(&conn).unwrap();
        let linked = get(&conn, 1).unwrap();
        assert_eq!(linked.shareholders[0].legal_role.as_deref(), Some("principal"));
        assert!(!linked.legal_rep_manual);
        let outsider = get(&conn, 2).unwrap();
        assert!(outsider.legal_rep_manual);
        assert_eq!(outsider.shareholders[0].legal_role, None);
    }
}
