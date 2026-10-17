//! Transacciones Cripto → Reporte de operaciones: cargas acumulativas de Excel por empresa y año.
//!
//! Aquí solo se guarda el ORIGEN (filas tal como llegaron, con su archivo y su fila) y las decisiones del usuario. Toda la
//! lógica (lectura del Excel, duplicados, cálculos de EEFF, formatos 1007 y 1647) vive en el frontend y se recalcula siempre
//! desde estos datos; nada calculado se guarda como fuente de verdad.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::services::time::now_iso;

const MAX_ROWS: usize = 200_000;
const MAX_JSON_BYTES: usize = 64_000;
const DECISION_KINDS: [&str; 6] = ["duplicate", "row_exclude", "assignment", "city", "country", "setting"];
const HOMOLOGATION_KINDS: [&str; 2] = ["document", "city"];

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CryptoUpload {
    pub id: i64,
    pub company_id: i64,
    pub year: i64,
    pub file_name: String,
    pub version: i64,
    pub status: String,
    pub sheets: Value,
    pub coverage_override: Option<Value>,
    pub imported_at: String,
    pub updated_at: String,
    pub row_count: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CryptoRow {
    pub id: i64,
    pub upload_id: i64,
    pub kind: String,
    pub sheet: String,
    pub row_number: i64,
    pub fingerprint: String,
    pub data: Value,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CryptoDecision {
    pub kind: String,
    pub key: String,
    pub value: String,
    pub fingerprint: String,
    pub decided_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CryptoVersion {
    pub upload_id: i64,
    pub version: i64,
    pub imported_at: String,
    pub rows_total: i64,
    pub summary: Value,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CryptoAuditEntry {
    pub id: i64,
    pub event: String,
    pub detail: Value,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CryptoState {
    pub uploads: Vec<CryptoUpload>,
    pub rows: Vec<CryptoRow>,
    pub decisions: Vec<CryptoDecision>,
    pub versions: Vec<CryptoVersion>,
    pub audit: Vec<CryptoAuditEntry>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Homologation {
    pub kind: String,
    pub source_key: String,
    pub value: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CryptoRowInput {
    pub kind: String,
    pub sheet: String,
    pub row_number: i64,
    pub fingerprint: String,
    pub data: Value,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveUploadInput {
    pub company_id: i64,
    pub year: i64,
    pub file_name: String,
    pub sheets: Value,
    pub rows: Vec<CryptoRowInput>,
    /// Resumen frente a la versión anterior (agregadas / modificadas / sin cambios / eliminadas); vacío en una carga nueva.
    #[serde(default)]
    pub summary: Value,
    /// El usuario confirmó reemplazar la carga existente con el mismo nombre.
    #[serde(default)]
    pub replace: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveUploadOutcome {
    /// `saved`: guardada · `exists`: ya hay una carga con ese nombre y no se confirmó el reemplazo (no se guardó nada).
    pub status: String,
    pub upload_id: i64,
    pub version: i64,
}

fn company_exists(conn: &Connection, id: i64) -> AppResult<()> {
    let ok: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)", [id], |r| r.get(0))?;
    if ok {
        Ok(())
    } else {
        Err(AppError::user("La empresa no existe o fue eliminada."))
    }
}

fn check_year(year: i64) -> AppResult<()> {
    if (2000..=2100).contains(&year) {
        Ok(())
    } else {
        Err(AppError::user("El año del reporte no es válido."))
    }
}

fn json_text(v: &Value) -> AppResult<String> {
    let text = serde_json::to_string(v)?;
    if text.len() > MAX_JSON_BYTES && v.is_object() {
        return Err(AppError::user("Una fila del archivo es demasiado grande para guardarse."));
    }
    Ok(text)
}

fn parse_json(text: String) -> Value {
    serde_json::from_str(&text).unwrap_or(Value::Null)
}

/// Auditoría de la empresa y el año (nunca falla la operación principal por no poder auditar).
pub fn audit(conn: &Connection, company_id: i64, year: i64, event: &str, detail: &Value) -> AppResult<()> {
    conn.execute(
        "INSERT INTO crypto_audit (company_id, year, event, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![company_id, year, event, serde_json::to_string(detail)?, now_iso()],
    )?;
    Ok(())
}

pub fn state(conn: &Connection, company_id: i64, year: i64) -> AppResult<CryptoState> {
    company_exists(conn, company_id)?;
    check_year(year)?;
    let uploads: Vec<CryptoUpload> = conn
        .prepare(
            "SELECT u.id, u.company_id, u.year, u.file_name, u.version, u.status, u.sheets, u.coverage_override, u.imported_at, u.updated_at,
                    (SELECT COUNT(*) FROM crypto_rows r WHERE r.upload_id = u.id)
             FROM crypto_uploads u WHERE u.company_id = ?1 AND u.year = ?2 ORDER BY u.imported_at, u.id",
        )?
        .query_map(params![company_id, year], |r| {
            Ok(CryptoUpload {
                id: r.get(0)?,
                company_id: r.get(1)?,
                year: r.get(2)?,
                file_name: r.get(3)?,
                version: r.get(4)?,
                status: r.get(5)?,
                sheets: parse_json(r.get(6)?),
                coverage_override: r.get::<_, Option<String>>(7)?.map(parse_json),
                imported_at: r.get(8)?,
                updated_at: r.get(9)?,
                row_count: r.get(10)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let rows = conn
        .prepare(
            "SELECT r.id, r.upload_id, r.kind, r.sheet, r.row_number, r.fingerprint, r.data
             FROM crypto_rows r JOIN crypto_uploads u ON u.id = r.upload_id
             WHERE u.company_id = ?1 AND u.year = ?2 ORDER BY r.upload_id, r.kind, r.row_number",
        )?
        .query_map(params![company_id, year], |r| {
            Ok(CryptoRow { id: r.get(0)?, upload_id: r.get(1)?, kind: r.get(2)?, sheet: r.get(3)?, row_number: r.get(4)?, fingerprint: r.get(5)?, data: parse_json(r.get(6)?) })
        })?
        .collect::<Result<_, _>>()?;
    let decisions = conn
        .prepare("SELECT kind, key, value, fingerprint, decided_at FROM crypto_decisions WHERE company_id = ?1 AND year = ?2 ORDER BY kind, key")?
        .query_map(params![company_id, year], |r| Ok(CryptoDecision { kind: r.get(0)?, key: r.get(1)?, value: r.get(2)?, fingerprint: r.get(3)?, decided_at: r.get(4)? }))?
        .collect::<Result<_, _>>()?;
    let versions = conn
        .prepare(
            "SELECT v.upload_id, v.version, v.imported_at, v.rows_total, v.summary
             FROM crypto_upload_versions v JOIN crypto_uploads u ON u.id = v.upload_id
             WHERE u.company_id = ?1 AND u.year = ?2 ORDER BY v.upload_id, v.version",
        )?
        .query_map(params![company_id, year], |r| Ok(CryptoVersion { upload_id: r.get(0)?, version: r.get(1)?, imported_at: r.get(2)?, rows_total: r.get(3)?, summary: parse_json(r.get(4)?) }))?
        .collect::<Result<_, _>>()?;
    let audit = conn
        .prepare("SELECT id, event, detail, created_at FROM crypto_audit WHERE company_id = ?1 AND year = ?2 ORDER BY id DESC LIMIT 200")?
        .query_map(params![company_id, year], |r| Ok(CryptoAuditEntry { id: r.get(0)?, event: r.get(1)?, detail: parse_json(r.get(2)?), created_at: r.get(3)? }))?
        .collect::<Result<_, _>>()?;
    Ok(CryptoState { uploads, rows, decisions, versions, audit })
}

fn validate_upload(conn: &Connection, input: &SaveUploadInput) -> AppResult<()> {
    company_exists(conn, input.company_id)?;
    check_year(input.year)?;
    if input.file_name.trim().is_empty() {
        return Err(AppError::user("El archivo no tiene nombre."));
    }
    if input.rows.is_empty() {
        return Err(AppError::user("El archivo no tiene filas en las hojas «Compras» y «Ventas»."));
    }
    if input.rows.len() > MAX_ROWS {
        return Err(AppError::user("El archivo tiene demasiadas filas."));
    }
    let mut seen = std::collections::HashSet::new();
    for r in &input.rows {
        if r.kind != "purchase" && r.kind != "sale" {
            return Err(AppError::user("Una fila del archivo no es de Compras ni de Ventas."));
        }
        if r.row_number < 1 || r.fingerprint.trim().is_empty() {
            return Err(AppError::user("Una fila del archivo no es válida."));
        }
        if !seen.insert((r.kind.as_str(), r.row_number)) {
            return Err(AppError::user("El archivo tiene filas repetidas en la misma hoja."));
        }
    }
    Ok(())
}

/// Guarda una carga. Con el mismo nombre dentro de la empresa y el año NO crea otra: exige `replace` y, al confirmar, sube la
/// versión y sustituye sus filas (lo que ya no está en la nueva versión deja de alimentar cálculos). Todo o nada.
pub fn save_upload(conn: &mut Connection, input: &SaveUploadInput) -> AppResult<SaveUploadOutcome> {
    validate_upload(conn, input)?;
    let tx = conn.transaction()?;
    let existing: Option<(i64, i64)> = tx
        .query_row("SELECT id, version FROM crypto_uploads WHERE company_id = ?1 AND year = ?2 AND file_name = ?3", params![input.company_id, input.year, input.file_name], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let now = now_iso();
    let sheets = serde_json::to_string(&input.sheets)?;
    let summary = serde_json::to_string(&input.summary)?;
    let (upload_id, version, event) = match existing {
        Some((id, version)) => {
            if !input.replace {
                return Ok(SaveUploadOutcome { status: "exists".into(), upload_id: id, version });
            }
            tx.execute("DELETE FROM crypto_rows WHERE upload_id = ?1", [id])?;
            tx.execute("UPDATE crypto_uploads SET version = ?1, status = 'active', sheets = ?2, imported_at = ?3, updated_at = ?3 WHERE id = ?4", params![version + 1, sheets, now, id])?;
            (id, version + 1, "upload_replaced")
        }
        None => {
            tx.execute(
                "INSERT INTO crypto_uploads (company_id, year, file_name, version, status, sheets, imported_at, updated_at) VALUES (?1, ?2, ?3, 1, 'active', ?4, ?5, ?5)",
                params![input.company_id, input.year, input.file_name, sheets, now],
            )?;
            (tx.last_insert_rowid(), 1, "upload_created")
        }
    };
    {
        let mut stmt = tx.prepare("INSERT INTO crypto_rows (upload_id, kind, sheet, row_number, fingerprint, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")?;
        for r in &input.rows {
            stmt.execute(params![upload_id, r.kind, r.sheet, r.row_number, r.fingerprint, json_text(&r.data)?])?;
        }
    }
    tx.execute("INSERT INTO crypto_upload_versions (upload_id, version, imported_at, rows_total, summary) VALUES (?1, ?2, ?3, ?4, ?5)", params![upload_id, version, now, input.rows.len() as i64, summary])?;
    audit(&tx, input.company_id, input.year, event, &serde_json::json!({ "fileName": input.file_name, "version": version, "rows": input.rows.len(), "summary": input.summary }))?;
    tx.commit()?;
    Ok(SaveUploadOutcome { status: "saved".into(), upload_id, version })
}

fn upload_scope(conn: &Connection, upload_id: i64) -> AppResult<(i64, i64, String)> {
    conn.query_row("SELECT company_id, year, file_name FROM crypto_uploads WHERE id = ?1", [upload_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?
        .ok_or_else(|| AppError::user("La carga no existe o fue eliminada."))
}

/// Retira o reactiva una carga: retirada no alimenta ningún cálculo, pero se conserva para auditoría.
pub fn set_upload_status(conn: &Connection, upload_id: i64, status: &str) -> AppResult<()> {
    if status != "active" && status != "retired" {
        return Err(AppError::user("El estado de la carga no es válido."));
    }
    let (company_id, year, file_name) = upload_scope(conn, upload_id)?;
    conn.execute("UPDATE crypto_uploads SET status = ?1, updated_at = ?2 WHERE id = ?3", params![status, now_iso(), upload_id])?;
    audit(conn, company_id, year, if status == "retired" { "upload_retired" } else { "upload_reactivated" }, &serde_json::json!({ "fileName": file_name }))
}

/// Ajusta los meses que cubre la carga (AAAA-MM dentro del año). `None` vuelve al período derivado de Compras.Fecha.
pub fn set_upload_coverage(conn: &Connection, upload_id: i64, months: Option<&[String]>) -> AppResult<()> {
    let (company_id, year, file_name) = upload_scope(conn, upload_id)?;
    let value = match months {
        None => None,
        Some(list) => {
            let prefix = format!("{year}-");
            for m in list {
                let ok = m.len() == 7 && m.starts_with(&prefix) && matches!(m[5..].parse::<u32>(), Ok(1..=12));
                if !ok {
                    return Err(AppError::user(format!("El período «{m}» no pertenece al año {year}.")));
                }
            }
            if list.is_empty() {
                return Err(AppError::user("Elige al menos un mes de cobertura."));
            }
            Some(serde_json::to_string(list)?)
        }
    };
    conn.execute("UPDATE crypto_uploads SET coverage_override = ?1, updated_at = ?2 WHERE id = ?3", params![value, now_iso(), upload_id])?;
    audit(conn, company_id, year, "coverage_adjusted", &serde_json::json!({ "fileName": file_name, "months": months }))
}

pub fn set_decision(conn: &Connection, company_id: i64, year: i64, kind: &str, key: &str, value: &str, fingerprint: &str) -> AppResult<()> {
    company_exists(conn, company_id)?;
    check_year(year)?;
    if !DECISION_KINDS.contains(&kind) {
        return Err(AppError::user("La clase de decisión no es válida."));
    }
    if key.trim().is_empty() {
        return Err(AppError::user("La decisión no tiene identificador."));
    }
    if kind == "duplicate" && value != "keep" && value != "exclude" {
        return Err(AppError::user("Elige «Conservar ambos» o «Excluir esta fila»."));
    }
    conn.execute(
        "INSERT INTO crypto_decisions (company_id, year, kind, key, value, fingerprint, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (company_id, year, kind, key) DO UPDATE SET value = excluded.value, fingerprint = excluded.fingerprint, decided_at = excluded.decided_at",
        params![company_id, year, kind, key, value, fingerprint, now_iso()],
    )?;
    audit(conn, company_id, year, &format!("decision_{kind}"), &serde_json::json!({ "key": key, "value": value }))
}

pub fn delete_decision(conn: &Connection, company_id: i64, year: i64, kind: &str, key: &str) -> AppResult<()> {
    company_exists(conn, company_id)?;
    let removed = conn.execute("DELETE FROM crypto_decisions WHERE company_id = ?1 AND year = ?2 AND kind = ?3 AND key = ?4", params![company_id, year, kind, key])?;
    if removed > 0 {
        audit(conn, company_id, year, &format!("decision_{kind}_removed"), &serde_json::json!({ "key": key }))?;
    }
    Ok(())
}

pub fn list_homologations(conn: &Connection) -> AppResult<Vec<Homologation>> {
    Ok(conn
        .prepare("SELECT kind, source_key, value FROM crypto_homologations ORDER BY kind, source_key")?
        .query_map([], |r| Ok(Homologation { kind: r.get(0)?, source_key: r.get(1)?, value: r.get(2)? }))?
        .collect::<Result<_, _>>()?)
}

pub fn save_homologation(conn: &Connection, kind: &str, source_key: &str, value: &str) -> AppResult<()> {
    if !HOMOLOGATION_KINDS.contains(&kind) {
        return Err(AppError::user("La clase de homologación no es válida."));
    }
    let (key, value) = (source_key.trim(), value.trim());
    if key.is_empty() || value.is_empty() {
        return Err(AppError::user("La equivalencia necesita el valor original y su destino."));
    }
    let valid = match kind {
        "document" => value.len() == 2 && value.chars().all(|c| c.is_ascii_digit()),
        _ => value.len() == 5 && value.chars().all(|c| c.is_ascii_digit()),
    };
    if !valid {
        return Err(AppError::user(if kind == "document" { "El código DIAN del tipo de documento debe tener dos dígitos." } else { "El código de municipio debe tener cinco dígitos (departamento + municipio)." }));
    }
    conn.execute(
        "INSERT INTO crypto_homologations (kind, source_key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (kind, source_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![kind, key, value, now_iso()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;
    use serde_json::json;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        run_pending(&mut c).unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        c.execute("INSERT INTO companies (id, razon_social, nit, created_at, updated_at) VALUES (1, 'A', '1', 'x', 'x'), (2, 'B', '2', 'x', 'x')", []).unwrap();
        c
    }

    fn row(kind: &str, n: i64, fp: &str) -> CryptoRowInput {
        CryptoRowInput { kind: kind.into(), sheet: if kind == "purchase" { "Compras".into() } else { "Ventas".into() }, row_number: n, fingerprint: fp.into(), data: json!({ "valor": n }) }
    }

    fn input(company: i64, year: i64, file: &str, rows: Vec<CryptoRowInput>, replace: bool) -> SaveUploadInput {
        SaveUploadInput { company_id: company, year, file_name: file.into(), sheets: json!(["Compras", "Ventas"]), rows, summary: json!({}), replace }
    }

    #[test]
    fn uploads_accumulate_per_company_and_year_and_never_mix() {
        let mut c = db();
        save_upload(&mut c, &input(1, 2026, "enero-marzo.xlsx", vec![row("purchase", 2, "a"), row("sale", 2, "b")], false)).unwrap();
        save_upload(&mut c, &input(1, 2026, "abril.xlsx", vec![row("purchase", 2, "c")], false)).unwrap();
        save_upload(&mut c, &input(2, 2026, "enero-marzo.xlsx", vec![row("purchase", 2, "d")], false)).unwrap();
        save_upload(&mut c, &input(1, 2025, "enero-marzo.xlsx", vec![row("purchase", 2, "e")], false)).unwrap();
        let s = state(&c, 1, 2026).unwrap();
        assert_eq!(s.uploads.len(), 2);
        assert_eq!(s.rows.len(), 3);
        assert_eq!(state(&c, 2, 2026).unwrap().uploads.len(), 1);
        assert_eq!(state(&c, 1, 2025).unwrap().rows.len(), 1);
    }

    #[test]
    fn same_name_needs_confirmation_and_replaces_without_a_second_upload() {
        let mut c = db();
        let first = save_upload(&mut c, &input(1, 2026, "a.xlsx", vec![row("purchase", 2, "a"), row("purchase", 3, "b")], false)).unwrap();
        // Sin confirmación no se guarda nada.
        let again = save_upload(&mut c, &input(1, 2026, "a.xlsx", vec![row("purchase", 2, "a")], false)).unwrap();
        assert_eq!((again.status.as_str(), again.upload_id), ("exists", first.upload_id));
        assert_eq!(state(&c, 1, 2026).unwrap().rows.len(), 2);
        // Confirmado: misma carga, versión 2, solo las filas nuevas.
        let replaced = save_upload(&mut c, &input(1, 2026, "a.xlsx", vec![row("purchase", 2, "a"), row("purchase", 4, "z")], true)).unwrap();
        assert_eq!((replaced.status.as_str(), replaced.upload_id, replaced.version), ("saved", first.upload_id, 2));
        let s = state(&c, 1, 2026).unwrap();
        assert_eq!(s.uploads.len(), 1);
        assert_eq!(s.rows.iter().map(|r| r.fingerprint.as_str()).collect::<Vec<_>>(), vec!["a", "z"]);
        assert_eq!(s.versions.len(), 2);
        assert!(s.audit.iter().any(|a| a.event == "upload_replaced"));
    }

    #[test]
    fn invalid_uploads_are_rejected_whole() {
        let mut c = db();
        assert!(save_upload(&mut c, &input(9, 2026, "a.xlsx", vec![row("purchase", 2, "a")], false)).is_err());
        assert!(save_upload(&mut c, &input(1, 1999, "a.xlsx", vec![row("purchase", 2, "a")], false)).is_err());
        assert!(save_upload(&mut c, &input(1, 2026, "a.xlsx", vec![], false)).is_err());
        assert!(save_upload(&mut c, &input(1, 2026, "a.xlsx", vec![row("other", 2, "a")], false)).is_err());
        assert!(save_upload(&mut c, &input(1, 2026, "a.xlsx", vec![row("purchase", 2, "a"), row("purchase", 2, "b")], false)).is_err());
        assert!(state(&c, 1, 2026).unwrap().uploads.is_empty(), "nada quedó a medias");
    }

    #[test]
    fn retiring_and_coverage_adjustments_are_validated_and_audited() {
        let mut c = db();
        let id = save_upload(&mut c, &input(1, 2026, "a.xlsx", vec![row("purchase", 2, "a")], false)).unwrap().upload_id;
        set_upload_status(&c, id, "retired").unwrap();
        assert_eq!(state(&c, 1, 2026).unwrap().uploads[0].status, "retired");
        assert!(set_upload_status(&c, id, "otro").is_err());
        set_upload_coverage(&c, id, Some(&["2026-01".to_string(), "2026-02".to_string()])).unwrap();
        assert_eq!(state(&c, 1, 2026).unwrap().uploads[0].coverage_override, Some(json!(["2026-01", "2026-02"])));
        assert!(set_upload_coverage(&c, id, Some(&["2025-12".to_string()])).is_err());
        assert!(set_upload_coverage(&c, id, Some(&["2026-13".to_string()])).is_err());
        set_upload_coverage(&c, id, None).unwrap();
        assert_eq!(state(&c, 1, 2026).unwrap().uploads[0].coverage_override, None);
    }

    #[test]
    fn decisions_are_scoped_and_validated() {
        let c = db();
        set_decision(&c, 1, 2026, "duplicate", "a.xlsx|purchase|fp|0", "exclude", "fp").unwrap();
        set_decision(&c, 1, 2026, "duplicate", "a.xlsx|purchase|fp|0", "keep", "fp").unwrap();
        assert_eq!(state(&c, 1, 2026).unwrap().decisions.len(), 1, "se actualiza, no se duplica");
        assert_eq!(state(&c, 1, 2026).unwrap().decisions[0].value, "keep");
        assert!(state(&c, 2, 2026).unwrap().decisions.is_empty());
        assert!(set_decision(&c, 1, 2026, "duplicate", "k", "quizas", "").is_err());
        assert!(set_decision(&c, 1, 2026, "otra", "k", "keep", "").is_err());
        delete_decision(&c, 1, 2026, "duplicate", "a.xlsx|purchase|fp|0").unwrap();
        assert!(state(&c, 1, 2026).unwrap().decisions.is_empty());
    }

    #[test]
    fn homologations_persist_and_validate_their_codes() {
        let c = db();
        save_homologation(&c, "document", "PPT", "42").unwrap();
        save_homologation(&c, "city", "STGO DE CALI", "76001").unwrap();
        save_homologation(&c, "city", "STGO DE CALI", "76109").unwrap();
        assert_eq!(list_homologations(&c).unwrap().len(), 2);
        assert!(save_homologation(&c, "document", "XX", "4").is_err());
        assert!(save_homologation(&c, "city", "Cali", "76").is_err());
        assert!(save_homologation(&c, "otra", "a", "b").is_err());
    }

    #[test]
    fn deleting_a_company_removes_its_crypto_data() {
        let mut c = db();
        save_upload(&mut c, &input(1, 2026, "a.xlsx", vec![row("purchase", 2, "a")], false)).unwrap();
        set_decision(&c, 1, 2026, "setting", "presentation", "otc", "").unwrap();
        c.execute("DELETE FROM companies WHERE id = 1", []).unwrap();
        for table in ["crypto_uploads", "crypto_rows", "crypto_decisions", "crypto_audit", "crypto_upload_versions"] {
            assert_eq!(c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get::<_, i64>(0)).unwrap(), 0, "{table}");
        }
    }
}
