//! Vigencia por fecha de las tarifas de retención y alias persistentes de Catálogos Exógena.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::time::now_iso;

fn valid_date(d: &str) -> bool {
    let b = d.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && d.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) && matches!(d[5..7].parse::<u32>(), Ok(1..=12)) && matches!(d[8..10].parse::<u32>(), Ok(1..=31))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RateVersion {
    pub rate_id: i64,
    pub effective_from: String,
    pub base_uvt_centi: i64,
    pub rate_bp: i64,
    pub note: String,
    pub created_at: String,
}

pub fn list_rate_versions(conn: &Connection) -> AppResult<Vec<RateVersion>> {
    let mut stmt = conn.prepare("SELECT rate_id, effective_from, base_uvt_centi, rate_bp, note, created_at FROM withholding_rate_versions ORDER BY rate_id, effective_from")?;
    let rows = stmt
        .query_map([], |r| Ok(RateVersion { rate_id: r.get(0)?, effective_from: r.get(1)?, base_uvt_centi: r.get(2)?, rate_bp: r.get(3)?, note: r.get(4)?, created_at: r.get(5)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Crea o reemplaza la vigencia de un concepto desde una fecha. Rige hacia adelante: las facturas anteriores conservan su regla.
pub fn save_rate_version(conn: &Connection, rate_id: i64, effective_from: &str, base_uvt_centi: i64, rate_bp: i64, note: &str) -> AppResult<()> {
    if !valid_date(effective_from) {
        return Err(AppError::user("La fecha efectiva debe ser una fecha válida (AAAA-MM-DD)."));
    }
    if base_uvt_centi < 0 || rate_bp <= 0 || rate_bp > 10_000 {
        return Err(AppError::user("La base en UVT no puede ser negativa y la tarifa debe estar entre 0,01 % y 100 %."));
    }
    let exists: i64 = conn.query_row("SELECT COUNT(*) FROM withholding_rates WHERE id = ?1", [rate_id], |r| r.get(0))?;
    if exists == 0 {
        return Err(AppError::user("El concepto de la Tabla de retenciones ya no existe. Recarga la pantalla."));
    }
    conn.execute(
        "INSERT INTO withholding_rate_versions (rate_id, effective_from, base_uvt_centi, rate_bp, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(rate_id, effective_from) DO UPDATE SET base_uvt_centi = excluded.base_uvt_centi, rate_bp = excluded.rate_bp, note = excluded.note",
        params![rate_id, effective_from, base_uvt_centi, rate_bp, note.trim(), now_iso()],
    )?;
    Ok(())
}

pub fn delete_rate_version(conn: &Connection, rate_id: i64, effective_from: &str) -> AppResult<()> {
    conn.execute("DELETE FROM withholding_rate_versions WHERE rate_id = ?1 AND effective_from = ?2", params![rate_id, effective_from])?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExoAlias {
    pub kind: String,
    pub alias_key: String,
    pub parent: String,
    pub alias: String,
    pub target: String,
    pub updated_at: String,
}

const ALIAS_KINDS: [&str; 4] = ["title_type", "municipality", "department", "country"];
/// Tipo de alias con tabla propia (tipos de documento de identificación).
const DOC_TYPE: &str = "document_type";

fn list_doc_type_aliases(conn: &Connection) -> AppResult<Vec<ExoAlias>> {
    let mut stmt = conn.prepare("SELECT alias_key, alias, target, updated_at FROM exo_document_type_aliases ORDER BY alias_key")?;
    let rows = stmt
        .query_map([], |r| Ok(ExoAlias { kind: DOC_TYPE.into(), alias_key: r.get(0)?, parent: String::new(), alias: r.get(1)?, target: r.get(2)?, updated_at: r.get(3)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn list_aliases(conn: &Connection, kind: Option<&str>) -> AppResult<Vec<ExoAlias>> {
    if kind == Some(DOC_TYPE) {
        return list_doc_type_aliases(conn);
    }
    let mut stmt = conn.prepare("SELECT kind, alias_key, parent, alias, target, updated_at FROM exo_aliases WHERE (?1 IS NULL OR kind = ?1) ORDER BY kind, alias_key, parent")?;
    let rows = stmt
        .query_map([kind], |r| Ok(ExoAlias { kind: r.get(0)?, alias_key: r.get(1)?, parent: r.get(2)?, alias: r.get(3)?, target: r.get(4)?, updated_at: r.get(5)? }))?
        .collect::<Result<Vec<ExoAlias>, _>>()?;
    let mut rows = rows;
    if kind.is_none() {
        rows.extend(list_doc_type_aliases(conn)?);
    }
    Ok(rows)
}

pub fn save_alias(conn: &Connection, kind: &str, alias_key: &str, parent: &str, alias: &str, target: &str) -> AppResult<()> {
    if kind != DOC_TYPE && !ALIAS_KINDS.contains(&kind) {
        return Err(AppError::user("Tipo de alias no válido."));
    }
    let alias = alias.split_whitespace().collect::<Vec<_>>().join(" ");
    let (key, target, parent) = (alias_key.trim(), target.trim(), parent.trim());
    if key.is_empty() || alias.is_empty() {
        return Err(AppError::user("El alias no puede estar vacío."));
    }
    if target.is_empty() {
        return Err(AppError::user("Elige a qué equivale el alias."));
    }
    let now = now_iso();
    if kind == DOC_TYPE {
        let known: i64 = conn.query_row("SELECT COUNT(*) FROM exo_document_types WHERE code = ?1", [target], |r| r.get(0))?;
        if known == 0 {
            return Err(AppError::user("El tipo de documento al que equivale el alias no existe en el catálogo."));
        }
        conn.execute(
            "INSERT INTO exo_document_type_aliases (alias_key, alias, target, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(alias_key) DO UPDATE SET alias = excluded.alias, target = excluded.target, updated_at = excluded.updated_at",
            params![key, alias, target, now],
        )?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO exo_aliases (kind, alias_key, parent, alias, target, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(kind, alias_key, parent) DO UPDATE SET alias = excluded.alias, target = excluded.target, updated_at = excluded.updated_at",
        params![kind, key, parent, alias, target, now],
    )?;
    Ok(())
}

pub fn delete_alias(conn: &Connection, kind: &str, alias_key: &str, parent: &str) -> AppResult<()> {
    if kind == DOC_TYPE {
        conn.execute("DELETE FROM exo_document_type_aliases WHERE alias_key = ?1", [alias_key])?;
        return Ok(());
    }
    conn.execute("DELETE FROM exo_aliases WHERE kind = ?1 AND alias_key = ?2 AND parent = ?3", params![kind, alias_key, parent])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        conn
    }

    #[test]
    fn rate_versions_validate_and_upsert_by_date() {
        let conn = db();
        let rate: i64 = conn.query_row("SELECT id FROM withholding_rates LIMIT 1", [], |r| r.get(0)).unwrap();
        assert!(save_rate_version(&conn, rate, "2026-13-01", 400, 400, "").is_err());
        assert!(save_rate_version(&conn, rate, "2026-07-01", 400, 0, "").is_err());
        assert!(save_rate_version(&conn, 99_999, "2026-07-01", 400, 400, "").is_err());
        save_rate_version(&conn, rate, "2026-07-01", 400, 350, "Decreto").unwrap();
        save_rate_version(&conn, rate, "2026-07-01", 500, 360, "Corrección").unwrap();
        let v = list_rate_versions(&conn).unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!((v[0].base_uvt_centi, v[0].rate_bp), (500, 360));
        delete_rate_version(&conn, rate, "2026-07-01").unwrap();
        assert!(list_rate_versions(&conn).unwrap().is_empty());
    }

    #[test]
    fn aliases_persist_per_kind_and_parent() {
        let conn = db();
        assert!(save_alias(&conn, "otro", "x", "", "X", "1").is_err());
        assert!(save_alias(&conn, "municipality", "", "", "  ", "1").is_err());
        save_alias(&conn, "municipality", "STA MARTA", "47", "Sta  Marta", "001").unwrap();
        save_alias(&conn, "municipality", "STA MARTA", "13", "Sta Marta", "999").unwrap();
        save_alias(&conn, "municipality", "STA MARTA", "47", "Sta Marta", "002").unwrap();
        save_alias(&conn, "title_type", "NOTA CREDITO", "", "Nota crédito", "nota credito electronica").unwrap();
        let m = list_aliases(&conn, Some("municipality")).unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!(m.iter().find(|a| a.parent == "47").unwrap().target, "002");
        assert_eq!(list_aliases(&conn, None).unwrap().iter().filter(|a| a.kind != "document_type").count(), 3);
        delete_alias(&conn, "municipality", "STA MARTA", "47").unwrap();
        assert_eq!(list_aliases(&conn, Some("municipality")).unwrap().len(), 1);
    }

    #[test]
    fn document_type_aliases_are_seeded_editable_and_validated_against_the_catalog() {
        let conn = db();
        let target = |key: &str| list_aliases(&conn, Some("document_type")).unwrap().into_iter().find(|a| a.alias_key == key).map(|a| a.target);
        for (key, code) in [("CC", "13"), ("CEDULADECIUDADANIA", "13"), ("CE", "22"), ("NIT", "31"), ("PPT", "48"), ("PEP", "47"), ("PASAPORTE", "41"), ("TI", "12"), ("TE", "21"), ("RC", "11")] {
            assert_eq!(target(key).as_deref(), Some(code), "{key}");
        }
        assert!(save_alias(&conn, "document_type", "XX", "", "Doc raro", "99").is_err(), "el código debe existir en el catálogo");
        save_alias(&conn, "document_type", "CEDULAEXT", "", "Cédula Ext.", "22").unwrap();
        assert_eq!(target("CEDULAEXT").as_deref(), Some("22"));
        assert!(list_aliases(&conn, None).unwrap().iter().any(|a| a.kind == "document_type" && a.alias_key == "CEDULAEXT"));
        delete_alias(&conn, "document_type", "CEDULAEXT", "").unwrap();
        assert_eq!(target("CEDULAEXT"), None);
    }
}
