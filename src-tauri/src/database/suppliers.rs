use rusqlite::{params, Connection, ErrorCode, Row};

use crate::error::{AppError, AppResult};
use crate::models::supplier::{Supplier, SupplierInput};
use crate::services::time::now_iso;

const COLUMNS: &str = "id, nit, business_name, vat_type, created_at, updated_at";

fn map(r: &Row) -> rusqlite::Result<Supplier> {
    Ok(Supplier {
        id: r.get(0)?,
        nit: r.get(1)?,
        business_name: r.get(2)?,
        vat_type: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

/// El NIT es único: un segundo proveedor con el mismo NIT se rechaza con un mensaje claro.
fn duplicate_nit(e: rusqlite::Error, nit: &str) -> AppError {
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == ErrorCode::ConstraintViolation => {
            AppError::user(format!("Ya existe un proveedor con el NIT {nit}."))
        }
        _ => e.into(),
    }
}

pub fn list(conn: &Connection, search: Option<&str>) -> AppResult<Vec<Supplier>> {
    let pattern = format!("%{}%", search.unwrap_or("").trim());
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM suppliers WHERE business_name LIKE ?1 OR nit LIKE ?1 ORDER BY business_name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([pattern], map)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn insert(conn: &Connection, s: &SupplierInput) -> AppResult<i64> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO suppliers (nit, business_name, vat_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![s.nit, s.business_name, s.vat_type, now],
    )
    .map_err(|e| duplicate_nit(e, &s.nit))?;
    Ok(conn.last_insert_rowid())
}

pub fn insert_full(conn: &Connection, s: &Supplier) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO suppliers ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
        params![s.id, s.nit, s.business_name, s.vat_type, s.created_at, s.updated_at],
    )
    .map_err(|e| duplicate_nit(e, &s.nit))?;
    Ok(())
}

pub fn update(conn: &Connection, id: i64, s: &SupplierInput) -> AppResult<()> {
    let n = conn
        .execute(
            "UPDATE suppliers SET nit = ?1, business_name = ?2, vat_type = ?3, updated_at = ?4 WHERE id = ?5",
            params![s.nit, s.business_name, s.vat_type, now_iso(), id],
        )
        .map_err(|e| duplicate_nit(e, &s.nit))?;
    if n == 0 {
        return Err(AppError::user("El proveedor no existe o fue eliminado."));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM suppliers WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    #[test]
    fn crud_and_unique_nit() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        let input = SupplierInput { nit: "900319753".into(), business_name: "PRICESMART COLOMBIA S.A.S.".into(), vat_type: "purchase".into() };
        let id = insert(&conn, &input).unwrap();
        assert!(insert(&conn, &input).unwrap_err().0.contains("900319753"));
        update(&conn, id, &SupplierInput { vat_type: "service".into(), ..input.clone() }).unwrap();
        let all = list(&conn, Some("9003")).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].vat_type, "service");
        delete(&conn, id).unwrap();
        assert!(list(&conn, None).unwrap().is_empty());
    }

    #[test]
    fn rejects_unknown_vat_type_in_sql() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        let bad = SupplierInput { nit: "1".into(), business_name: "A".into(), vat_type: "otro".into() };
        assert!(insert(&conn, &bad).is_err());
    }
}
