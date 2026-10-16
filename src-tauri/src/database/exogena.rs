//! Información Exógena: catálogos, estado anual por formato y registros sincronizados / corregidos a mano.
//!
//! El cálculo de cada formato vive en el frontend (funciones puras con pruebas); aquí solo se guarda, con las garantías
//! que no deben depender de la pantalla: sincronizaciones idempotentes por clave de origen, correcciones manuales que
//! una sincronización no pisa sin confirmación, justificación obligatoria de «No aplica» y bitácora.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};

use crate::error::{AppError, AppResult};
use crate::models::exogena::*;
use crate::models::third_party::{ThirdPartyData, COLOMBIA};
use crate::services::time::now_iso;

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

fn meta(conn: &Connection, key: &str) -> AppResult<String> {
    Ok(conn.query_row("SELECT value FROM exo_catalog_meta WHERE key = ?1", [key], |r| r.get(0)).optional()?.unwrap_or_default())
}

pub fn list_catalogs(conn: &Connection) -> AppResult<ExoCatalogs> {
    let flag = |v: i64| v != 0;
    Ok(ExoCatalogs {
        version: meta(conn, "version")?,
        source: meta(conn, "source")?,
        document_types: conn
            .prepare("SELECT code, description, is_system, is_active FROM exo_document_types ORDER BY code")?
            .query_map([], |r| Ok(DocumentType { code: r.get(0)?, description: r.get(1)?, is_system: flag(r.get(2)?), is_active: flag(r.get(3)?) }))?
            .collect::<Result<_, _>>()?,
        countries: conn
            .prepare("SELECT code, name, is_system, is_active FROM exo_countries ORDER BY name COLLATE NOCASE")?
            .query_map([], |r| Ok(Country { code: r.get(0)?, name: r.get(1)?, is_system: flag(r.get(2)?), is_active: flag(r.get(3)?) }))?
            .collect::<Result<_, _>>()?,
        departments: conn
            .prepare("SELECT code, name, is_system, is_active FROM exo_departments ORDER BY name COLLATE NOCASE")?
            .query_map([], |r| Ok(Department { code: r.get(0)?, name: r.get(1)?, is_system: flag(r.get(2)?), is_active: flag(r.get(3)?) }))?
            .collect::<Result<_, _>>()?,
        municipalities: conn
            .prepare("SELECT dept_code, code, name, is_system, is_active FROM exo_municipalities ORDER BY dept_code, name COLLATE NOCASE")?
            .query_map([], |r| Ok(Municipality { dept_code: r.get(0)?, code: r.get(1)?, name: r.get(2)?, is_system: flag(r.get(3)?), is_active: flag(r.get(4)?) }))?
            .collect::<Result<_, _>>()?,
    })
}

fn audit(conn: &Connection, catalog: &str, code: &str, action: &str, old_value: &str, new_value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO exo_catalog_audit (catalog, code, action, old_value, new_value, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![catalog, code, action, old_value, new_value, now_iso()],
    )?;
    Ok(())
}

pub fn list_audit(conn: &Connection, limit: i64) -> AppResult<Vec<CatalogAuditEntry>> {
    Ok(conn
        .prepare("SELECT id, catalog, code, action, old_value, new_value, changed_at FROM exo_catalog_audit ORDER BY id DESC LIMIT ?1")?
        .query_map([limit.clamp(1, 1000)], |r| {
            Ok(CatalogAuditEntry { id: r.get(0)?, catalog: r.get(1)?, code: r.get(2)?, action: r.get(3)?, old_value: r.get(4)?, new_value: r.get(5)?, changed_at: r.get(6)? })
        })?
        .collect::<Result<_, _>>()?)
}

/// Crea una entrada propia o ajusta nombre / estado de una existente (también las de sistema). Todo cambio queda en la auditoría.
pub fn save_catalog_entry(conn: &mut Connection, input: &CatalogEntryInput) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_iso();
    let (table, name_col) = match input.catalog.as_str() {
        "document_types" => ("exo_document_types", "description"),
        "countries" => ("exo_countries", "name"),
        "departments" => ("exo_departments", "name"),
        _ => ("exo_municipalities", "name"),
    };
    let municipality = input.catalog == "municipalities";
    let existing: Option<(String, i64)> = if municipality {
        tx.query_row(&format!("SELECT {name_col}, is_active FROM {table} WHERE code = ?1 AND dept_code = ?2"), params![input.code, input.parent_code], |r| Ok((r.get(0)?, r.get(1)?))).optional()?
    } else {
        tx.query_row(&format!("SELECT {name_col}, is_active FROM {table} WHERE code = ?1"), [&input.code], |r| Ok((r.get(0)?, r.get(1)?))).optional()?
    };
    let audit_code = if municipality { format!("{}{}", input.parent_code, input.code) } else { input.code.clone() };
    match existing {
        None => {
            if municipality {
                let dept: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM exo_departments WHERE code = ?1)", [&input.parent_code], |r| r.get(0))?;
                if !dept {
                    return Err(AppError::user("El departamento del municipio no existe."));
                }
                tx.execute("INSERT INTO exo_municipalities (dept_code, code, name, is_system, is_active, updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?5)", params![input.parent_code, input.code, input.name, input.is_active, now])?;
            } else {
                tx.execute(&format!("INSERT INTO {table} (code, {name_col}, is_system, is_active, updated_at) VALUES (?1, ?2, 0, ?3, ?4)"), params![input.code, input.name, input.is_active, now])?;
            }
            audit(&tx, &input.catalog, &audit_code, "add", "", &input.name)?;
        }
        Some((old_name, old_active)) => {
            if old_name != input.name {
                if municipality {
                    tx.execute("UPDATE exo_municipalities SET name = ?1, updated_at = ?2 WHERE dept_code = ?3 AND code = ?4", params![input.name, now, input.parent_code, input.code])?;
                } else {
                    tx.execute(&format!("UPDATE {table} SET {name_col} = ?1, updated_at = ?2 WHERE code = ?3"), params![input.name, now, input.code])?;
                }
                audit(&tx, &input.catalog, &audit_code, "rename", &old_name, &input.name)?;
            }
            if (old_active != 0) != input.is_active {
                if municipality {
                    tx.execute(&format!("UPDATE {table} SET is_active = ?1, updated_at = ?2 WHERE dept_code = ?3 AND code = ?4"), params![input.is_active, now, input.parent_code, input.code])?;
                } else {
                    tx.execute(&format!("UPDATE {table} SET is_active = ?1, updated_at = ?2 WHERE code = ?3"), params![input.is_active, now, input.code])?;
                }
                audit(&tx, &input.catalog, &audit_code, if input.is_active { "activate" } else { "deactivate" }, "", &input.name)?;
            }
        }
    }
    tx.commit()?;
    Ok(())
}

/// Elimina una entrada PROPIA que nadie usa. Las de sistema no se eliminan (se desactivan).
pub fn delete_catalog_entry(conn: &mut Connection, catalog: &str, code: &str, parent_code: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let (is_system, name): (i64, String) = match catalog {
        "document_types" => tx.query_row("SELECT is_system, description FROM exo_document_types WHERE code = ?1", [code], |r| Ok((r.get(0)?, r.get(1)?))).optional()?,
        "countries" => tx.query_row("SELECT is_system, name FROM exo_countries WHERE code = ?1", [code], |r| Ok((r.get(0)?, r.get(1)?))).optional()?,
        "departments" => tx.query_row("SELECT is_system, name FROM exo_departments WHERE code = ?1", [code], |r| Ok((r.get(0)?, r.get(1)?))).optional()?,
        "municipalities" => tx.query_row("SELECT is_system, name FROM exo_municipalities WHERE dept_code = ?1 AND code = ?2", [parent_code, code], |r| Ok((r.get(0)?, r.get(1)?))).optional()?,
        _ => return Err(AppError::user("El catálogo no existe.")),
    }
    .ok_or_else(|| AppError::user("La entrada no existe."))?;
    if is_system != 0 {
        return Err(AppError::user("Los valores del sistema no se eliminan; desactívalos si no los necesitas."));
    }
    let in_use: bool = match catalog {
        "document_types" => tx.query_row("SELECT EXISTS(SELECT 1 FROM suppliers WHERE doc_type_code = ?1) OR EXISTS(SELECT 1 FROM shareholders WHERE doc_type_code = ?1)", [code], |r| r.get(0))?,
        "countries" => tx.query_row("SELECT EXISTS(SELECT 1 FROM suppliers WHERE country_code = ?1) OR EXISTS(SELECT 1 FROM shareholders WHERE country_code = ?1)", [code], |r| r.get(0))?,
        "departments" => tx.query_row("SELECT EXISTS(SELECT 1 FROM suppliers WHERE dept_code = ?1) OR EXISTS(SELECT 1 FROM shareholders WHERE dept_code = ?1) OR EXISTS(SELECT 1 FROM exo_municipalities WHERE dept_code = ?1)", [code], |r| r.get(0))?,
        _ => tx.query_row("SELECT EXISTS(SELECT 1 FROM suppliers WHERE dept_code = ?1 AND muni_code = ?2) OR EXISTS(SELECT 1 FROM shareholders WHERE dept_code = ?1 AND muni_code = ?2)", [parent_code, code], |r| r.get(0))?,
    };
    if in_use {
        return Err(AppError::user("Hay terceros o socios que usan esta entrada; desactívala en lugar de eliminarla."));
    }
    match catalog {
        "document_types" => tx.execute("DELETE FROM exo_document_types WHERE code = ?1", [code])?,
        "countries" => tx.execute("DELETE FROM exo_countries WHERE code = ?1", [code])?,
        "departments" => tx.execute("DELETE FROM exo_departments WHERE code = ?1", [code])?,
        _ => tx.execute("DELETE FROM exo_municipalities WHERE dept_code = ?1 AND code = ?2", [parent_code, code])?,
    };
    audit(&tx, catalog, &if catalog == "municipalities" { format!("{parent_code}{code}") } else { code.to_string() }, "delete", &name, "")?;
    tx.commit()?;
    Ok(())
}

/// Valida los códigos contra los catálogos y completa los nombres. Un país distinto de Colombia no lleva departamento ni municipio.
pub fn resolve_third_party(conn: &Connection, data: &mut ThirdPartyData) -> AppResult<()> {
    if let Some(code) = &data.doc_type_code {
        let known: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM exo_document_types WHERE code = ?1)", [code], |r| r.get(0))?;
        if !known {
            return Err(AppError::user(format!("El tipo de documento {code} no está en el catálogo de Exógena.")));
        }
    }
    data.country_name.clear();
    data.dept_name.clear();
    data.muni_name.clear();
    if !data.country_code.is_empty() {
        data.country_name = conn
            .query_row("SELECT name FROM exo_countries WHERE code = ?1", [&data.country_code], |r| r.get(0))
            .optional()?
            .ok_or_else(|| AppError::user(format!("El país {} no está en el catálogo de Exógena.", data.country_code)))?;
    }
    if data.country_code != COLOMBIA {
        data.dept_code.clear();
        data.muni_code.clear();
        return Ok(());
    }
    if !data.dept_code.is_empty() {
        data.dept_name = conn
            .query_row("SELECT name FROM exo_departments WHERE code = ?1", [&data.dept_code], |r| r.get(0))
            .optional()?
            .ok_or_else(|| AppError::user(format!("El departamento {} no está en el catálogo de Exógena.", data.dept_code)))?;
    }
    if !data.muni_code.is_empty() {
        if data.dept_code.is_empty() {
            return Err(AppError::user("Selecciona el departamento antes del municipio."));
        }
        data.muni_name = conn
            .query_row("SELECT name FROM exo_municipalities WHERE dept_code = ?1 AND code = ?2", [&data.dept_code, &data.muni_code], |r| r.get(0))
            .optional()?
            .ok_or_else(|| AppError::user(format!("El municipio {}{} no existe en el catálogo de Exógena.", data.dept_code, data.muni_code)))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Estado por formato
// ---------------------------------------------------------------------------

pub fn list_status(conn: &Connection, company_id: i64, year: i64) -> AppResult<Vec<FormatStatusRow>> {
    Ok(conn
        .prepare(
            "SELECT f.format_code, f.status, f.not_applicable_reason, f.last_synced_at, f.source_fingerprint, f.updated_at,
                    (SELECT COUNT(*) FROM exo_records r WHERE r.company_id = f.company_id AND r.year = f.year AND r.format_code = f.format_code)
             FROM exo_format_status f WHERE f.company_id = ?1 AND f.year = ?2 ORDER BY f.format_code",
        )?
        .query_map(params![company_id, year], |r| {
            Ok(FormatStatusRow { format_code: r.get(0)?, status: r.get(1)?, not_applicable_reason: r.get(2)?, last_synced_at: r.get(3)?, source_fingerprint: r.get(4)?, updated_at: r.get(5)?, record_count: r.get(6)? })
        })?
        .collect::<Result<_, _>>()?)
}

/// Cantidad de registros por formato aunque el formato aún no tenga fila de estado.
pub fn record_counts(conn: &Connection, company_id: i64, year: i64) -> AppResult<Vec<(String, i64)>> {
    Ok(conn
        .prepare("SELECT format_code, COUNT(*) FROM exo_records WHERE company_id = ?1 AND year = ?2 GROUP BY format_code")?
        .query_map(params![company_id, year], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?)
}

fn ensure_status_row(conn: &Connection, company_id: i64, year: i64, format_code: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO exo_format_status (company_id, year, format_code, status, updated_at) VALUES (?1, ?2, ?3, 'en_preparacion', ?4)",
        params![company_id, year, format_code, now_iso()],
    )?;
    Ok(())
}

fn require_company(conn: &Connection, company_id: i64) -> AppResult<()> {
    let ok: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)", [company_id], |r| r.get(0))?;
    if ok {
        Ok(())
    } else {
        Err(AppError::user("La empresa no existe o fue eliminada."))
    }
}

pub fn set_status(conn: &Connection, company_id: i64, year: i64, format_code: &str, status: &str, reason: &str) -> AppResult<()> {
    if !STATUSES.contains(&status) {
        return Err(AppError::user("El estado del formato no es válido."));
    }
    if !(2000..=2100).contains(&year) || format_code.is_empty() || !format_code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::user("El formato o el año no son válidos."));
    }
    let reason = crate::models::clean(reason, 500);
    if status == "no_aplica" && reason.chars().count() < 5 {
        return Err(AppError::user("Escribe una justificación breve para marcar el formato como «No aplica»."));
    }
    require_company(conn, company_id)?;
    ensure_status_row(conn, company_id, year, format_code)?;
    conn.execute(
        "UPDATE exo_format_status SET status = ?1, not_applicable_reason = ?2, updated_at = ?3 WHERE company_id = ?4 AND year = ?5 AND format_code = ?6",
        params![status, if status == "no_aplica" { reason } else { String::new() }, now_iso(), company_id, year, format_code],
    )?;
    Ok(())
}

/// Un formato «listo» deja de estarlo cuando sus registros cambian: hay que revisarlo y marcarlo de nuevo.
fn invalidate_ready(conn: &Connection, company_id: i64, year: i64, format_code: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE exo_format_status SET status = 'requiere_actualizacion', updated_at = ?1 WHERE company_id = ?2 AND year = ?3 AND format_code = ?4 AND status = 'listo'",
        params![now_iso(), company_id, year, format_code],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Registros
// ---------------------------------------------------------------------------

const RECORD_COLUMNS: &str = "id, company_id, year, format_code, source_key, origin, origin_ref, data, manual_fields, manually_modified_at, synced_at, created_at, updated_at";

fn map_record(r: &rusqlite::Row) -> rusqlite::Result<ExoRecord> {
    let data: String = r.get(7)?;
    let manual: String = r.get(8)?;
    Ok(ExoRecord {
        id: r.get(0)?,
        company_id: r.get(1)?,
        year: r.get(2)?,
        format_code: r.get(3)?,
        source_key: r.get(4)?,
        origin: r.get(5)?,
        origin_ref: r.get(6)?,
        data: serde_json::from_str(&data).unwrap_or(Value::Object(Map::new())),
        manual_fields: serde_json::from_str(&manual).unwrap_or_default(),
        manually_modified_at: r.get(9)?,
        synced_at: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

pub fn list_records(conn: &Connection, company_id: i64, year: i64, format_code: &str) -> AppResult<Vec<ExoRecord>> {
    Ok(conn
        .prepare(&format!("SELECT {RECORD_COLUMNS} FROM exo_records WHERE company_id = ?1 AND year = ?2 AND format_code = ?3 ORDER BY id"))?
        .query_map(params![company_id, year, format_code], map_record)?
        .collect::<Result<_, _>>()?)
}

fn get_record(conn: &Connection, id: i64) -> AppResult<ExoRecord> {
    conn.query_row(&format!("SELECT {RECORD_COLUMNS} FROM exo_records WHERE id = ?1"), [id], map_record)
        .optional()?
        .ok_or_else(|| AppError::user("El registro no existe o fue eliminado."))
}

fn object(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

/// Sincroniza propuestas con los registros guardados. Todo o nada; repetirla con las mismas propuestas no cambia nada.
pub fn apply_sync(conn: &mut Connection, input: &ApplySyncInput) -> AppResult<SyncOutcome> {
    require_company(conn, input.company_id)?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let mut outcome = SyncOutcome::default();

    for p in &input.proposals {
        let existing: Option<ExoRecord> = tx
            .query_row(
                &format!("SELECT {RECORD_COLUMNS} FROM exo_records WHERE company_id = ?1 AND year = ?2 AND format_code = ?3 AND source_key = ?4"),
                params![input.company_id, input.year, input.format_code, p.source_key],
                map_record,
            )
            .optional()?;
        let proposed = object(&p.data);
        match existing {
            None => {
                tx.execute(
                    "INSERT INTO exo_records (company_id, year, format_code, source_key, origin, origin_ref, data, manual_fields, synced_at, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '[]', ?8, ?8, ?8)",
                    params![input.company_id, input.year, input.format_code, p.source_key, p.origin, p.origin_ref, Value::Object(proposed).to_string(), now],
                )?;
                outcome.created += 1;
            }
            Some(old) => {
                let overwrite = input.overwrite_manual.contains(&p.source_key);
                let old_data = object(&old.data);
                let mut next = old_data.clone();
                let mut conflict_fields = Vec::new();
                for (key, value) in &proposed {
                    let manual = old.manual_fields.contains(key);
                    if manual && !overwrite {
                        if old_data.get(key) != Some(value) {
                            conflict_fields.push(key.clone());
                        }
                        continue;
                    }
                    next.insert(key.clone(), value.clone());
                }
                if !conflict_fields.is_empty() {
                    outcome.conflicts.push(SyncConflict { source_key: p.source_key.clone(), fields: conflict_fields });
                }
                let manual_fields = if overwrite { Vec::new() } else { old.manual_fields.clone() };
                let changed = next != old_data || old.origin_ref != p.origin_ref || (overwrite && !old.manual_fields.is_empty());
                if changed {
                    tx.execute(
                        "UPDATE exo_records SET data = ?1, origin_ref = ?2, manual_fields = ?3, manually_modified_at = CASE WHEN ?4 THEN NULL ELSE manually_modified_at END, synced_at = ?5, updated_at = ?5 WHERE id = ?6",
                        params![Value::Object(next).to_string(), p.origin_ref, serde_json::to_string(&manual_fields)?, overwrite, now, old.id],
                    )?;
                    outcome.updated += 1;
                } else {
                    tx.execute("UPDATE exo_records SET synced_at = ?1 WHERE id = ?2", params![now, old.id])?;
                    outcome.unchanged += 1;
                }
            }
        }
    }

    if input.remove_missing {
        let keys: std::collections::HashSet<&str> = input.proposals.iter().map(|p| p.source_key.as_str()).collect();
        for old in list_records(&tx, input.company_id, input.year, &input.format_code)? {
            if old.origin == "manual" || keys.contains(old.source_key.as_str()) {
                continue;
            }
            if old.manual_fields.is_empty() {
                tx.execute("DELETE FROM exo_records WHERE id = ?1", [old.id])?;
                outcome.removed += 1;
            } else {
                outcome.kept_manual_orphans.push(old.source_key);
            }
        }
    }

    ensure_status_row(&tx, input.company_id, input.year, &input.format_code)?;
    tx.execute(
        "UPDATE exo_format_status SET last_synced_at = ?1, source_fingerprint = COALESCE(?2, source_fingerprint) WHERE company_id = ?3 AND year = ?4 AND format_code = ?5",
        params![now, input.source_fingerprint, input.company_id, input.year, input.format_code],
    )?;
    if outcome.created + outcome.updated + outcome.removed > 0 {
        invalidate_ready(&tx, input.company_id, input.year, &input.format_code)?;
    }
    tx.execute(
        "INSERT INTO exo_sync_runs (company_id, year, format_code, source, ran_at, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.company_id,
            input.year,
            input.format_code,
            input.source,
            now,
            json!({ "created": outcome.created, "updated": outcome.updated, "unchanged": outcome.unchanged, "removed": outcome.removed, "conflicts": outcome.conflicts.len(), "details": input.summary }).to_string()
        ],
    )?;
    tx.commit()?;
    Ok(outcome)
}

pub fn list_sync_runs(conn: &Connection, company_id: i64, year: i64, limit: i64) -> AppResult<Vec<SyncRun>> {
    Ok(conn
        .prepare("SELECT id, format_code, source, ran_at, summary FROM exo_sync_runs WHERE company_id = ?1 AND year = ?2 ORDER BY id DESC LIMIT ?3")?
        .query_map(params![company_id, year, limit.clamp(1, 200)], |r| {
            let summary: String = r.get(4)?;
            Ok(SyncRun { id: r.get(0)?, format_code: r.get(1)?, source: r.get(2)?, ran_at: r.get(3)?, summary: serde_json::from_str(&summary).unwrap_or(Value::Null) })
        })?
        .collect::<Result<_, _>>()?)
}

/// Corrección manual: solo cambia los campos enviados y los marca como manuales (una sincronización no los reemplaza sin confirmación).
pub fn update_record(conn: &mut Connection, id: i64, patch: &Value) -> AppResult<ExoRecord> {
    let Some(patch) = patch.as_object() else {
        return Err(AppError::user("La corrección debe ser un objeto con los campos a cambiar."));
    };
    let tx = conn.transaction()?;
    let old = get_record(&tx, id)?;
    let mut data = object(&old.data);
    let mut manual = old.manual_fields.clone();
    for (key, value) in patch {
        if data.get(key) != Some(value) {
            data.insert(key.clone(), value.clone());
            if old.origin != "manual" && !manual.contains(key) {
                manual.push(key.clone());
            }
        }
    }
    let now = now_iso();
    tx.execute(
        "UPDATE exo_records SET data = ?1, manual_fields = ?2, manually_modified_at = ?3, updated_at = ?3 WHERE id = ?4",
        params![Value::Object(data).to_string(), serde_json::to_string(&manual)?, now, id],
    )?;
    invalidate_ready(&tx, old.company_id, old.year, &old.format_code)?;
    let updated = get_record(&tx, id)?;
    tx.commit()?;
    Ok(updated)
}

pub fn create_manual_record(conn: &mut Connection, company_id: i64, year: i64, format_code: &str, data: &Value) -> AppResult<ExoRecord> {
    if !data.is_object() {
        return Err(AppError::user("Los datos del registro deben ser un objeto."));
    }
    require_company(conn, company_id)?;
    let tx = conn.transaction()?;
    let now = now_iso();
    // La clave es única por registro manual: la fecha en nanosegundos más el siguiente id evita colisiones.
    let next: i64 = tx.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM exo_records", [], |r| r.get(0))?;
    let key = format!("manual:{next}");
    tx.execute(
        "INSERT INTO exo_records (company_id, year, format_code, source_key, origin, origin_ref, data, manual_fields, manually_modified_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'manual', 'Registro manual', ?5, '[]', ?6, ?6, ?6)",
        params![company_id, year, format_code, key, data.to_string(), now],
    )?;
    let id = tx.last_insert_rowid();
    ensure_status_row(&tx, company_id, year, format_code)?;
    invalidate_ready(&tx, company_id, year, format_code)?;
    let created = get_record(&tx, id)?;
    tx.commit()?;
    Ok(created)
}

pub fn delete_record(conn: &mut Connection, id: i64) -> AppResult<()> {
    let tx = conn.transaction()?;
    let old = get_record(&tx, id)?;
    if old.origin != "manual" {
        return Err(AppError::user("Solo se pueden eliminar registros manuales: los sincronizados salen cuando cambia su fuente."));
    }
    tx.execute("DELETE FROM exo_records WHERE id = ?1", [id])?;
    invalidate_ready(&tx, old.company_id, old.year, &old.format_code)?;
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Huella de los datos de origen (1010: socios y capital de Empresas)
// ---------------------------------------------------------------------------

fn fnv1a(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Huella de lo que alimenta el 1010: capital suscrito y, de cada socio, identificación, ubicación y participación.
pub fn source_fingerprint(conn: &Connection, company_id: i64) -> AppResult<String> {
    let (shares, nominal): (Option<i64>, Option<i64>) =
        conn.query_row("SELECT subscribed_total_shares, subscribed_nominal_value FROM companies WHERE id = ?1", [company_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?.unwrap_or((None, None));
    let mut text = format!("capital:{shares:?}:{nominal:?}\n");
    let rows = conn
        .prepare(
            "SELECT id, name, identity_document, percentage, COALESCE(doc_type_code, ''), dv, COALESCE(person_type, ''), first_surname, second_surname, first_name, other_names,
                    address, country_code, dept_code, muni_code
             FROM shareholders WHERE company_id = ?1 ORDER BY id",
        )?
        .query_map([company_id], |r| {
            let mut fields = Vec::with_capacity(15);
            for i in 0..15 {
                fields.push(match r.get_ref(i)? {
                    rusqlite::types::ValueRef::Integer(v) => v.to_string(),
                    rusqlite::types::ValueRef::Real(v) => format!("{v:.4}"),
                    rusqlite::types::ValueRef::Text(t) => String::from_utf8_lossy(t).to_string(),
                    _ => String::new(),
                });
            }
            Ok(fields.join("|"))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    text.push_str(&rows.join("\n"));
    Ok(fnv1a(&text))
}

/// Si cambian los socios o el capital de una empresa, sus 1010 ya marcados «listo» pasan a «requiere actualización».
/// Nunca reescribe los registros: la actualización la decide el usuario en Exógena.
pub fn flag_stale_shareholder_formats(conn: &Connection, company_id: i64) -> AppResult<()> {
    let current = source_fingerprint(conn, company_id)?;
    conn.execute(
        "UPDATE exo_format_status SET status = 'requiere_actualizacion', updated_at = ?1
         WHERE company_id = ?2 AND format_code = '1010' AND status = 'listo' AND source_fingerprint <> '' AND source_fingerprint <> ?3",
        params![now_iso(), company_id, current],
    )?;
    Ok(())
}

/// Ayuda para pruebas de otros módulos: una sincronización mínima de un 1010.
#[cfg(test)]
pub struct ApplySyncInputForTest(pub ApplySyncInput);

#[cfg(test)]
impl ApplySyncInputForTest {
    pub fn new(company_id: i64, data: Value, fingerprint: String) -> Self {
        ApplySyncInputForTest(ApplySyncInput {
            company_id,
            year: 2025,
            format_code: "1010".into(),
            source: "empresas".into(),
            proposals: vec![SyncProposal { source_key: "shareholder:1".into(), origin: "empresas".into(), origin_ref: String::new(), data }],
            remove_missing: true,
            source_fingerprint: Some(fingerprint),
            overwrite_manual: vec![],
            summary: Value::Null,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).unwrap();
        conn.execute("INSERT INTO companies (id, razon_social, nit, created_at, updated_at) VALUES (1, 'E', '900', 'x', 'x')", []).unwrap();
        conn
    }

    fn proposal(key: &str, data: Value) -> SyncProposal {
        SyncProposal { source_key: key.into(), origin: "empresas".into(), origin_ref: format!("Socio {key}"), data }
    }

    fn input(proposals: Vec<SyncProposal>) -> ApplySyncInput {
        ApplySyncInput { company_id: 1, year: 2025, format_code: "1010".into(), source: "empresas".into(), proposals, remove_missing: true, source_fingerprint: None, overwrite_manual: vec![], summary: Value::Null }
    }

    #[test]
    fn resolves_territory_names_and_rejects_inconsistent_codes() {
        let conn = db();
        let mut d = ThirdPartyData { doc_type_code: Some("13".into()), country_code: "169".into(), dept_code: "76".into(), muni_code: "001".into(), ..Default::default() };
        resolve_third_party(&conn, &mut d).unwrap();
        assert_eq!((d.country_name.as_str(), d.dept_name.as_str(), d.muni_name.as_str()), ("COLOMBIA", "Valle del Cauca", "Cali"));
        // El código de cinco caracteres «76001» se compone de departamento 76 + municipio 001; el municipio de otro departamento no existe.
        let mut wrong = ThirdPartyData { country_code: "169".into(), dept_code: "05".into(), muni_code: "999".into(), ..Default::default() };
        assert!(resolve_third_party(&conn, &mut wrong).unwrap_err().0.contains("05999"));
        let mut no_dept = ThirdPartyData { country_code: "169".into(), muni_code: "001".into(), ..Default::default() };
        assert!(resolve_third_party(&conn, &mut no_dept).is_err());
        let mut bad_type = ThirdPartyData { doc_type_code: Some("99".into()), ..Default::default() };
        assert!(resolve_third_party(&conn, &mut bad_type).is_err());
        let mut bad_country = ThirdPartyData { country_code: "000".into(), ..Default::default() };
        assert!(resolve_third_party(&conn, &mut bad_country).is_err());
        // Fuera de Colombia no hay departamento ni municipio.
        let mut abroad = ThirdPartyData { country_code: "249".into(), dept_code: "76".into(), muni_code: "001".into(), ..Default::default() };
        resolve_third_party(&conn, &mut abroad).unwrap();
        assert!(abroad.dept_code.is_empty() && abroad.muni_code.is_empty());
    }

    #[test]
    fn catalog_changes_are_audited_and_system_values_are_never_deleted() {
        let mut conn = db();
        save_catalog_entry(&mut conn, &CatalogEntryInput { catalog: "document_types".into(), code: "99".into(), parent_code: String::new(), name: "Propio".into(), is_active: true }.validated().unwrap()).unwrap();
        save_catalog_entry(&mut conn, &CatalogEntryInput { catalog: "document_types".into(), code: "13".into(), parent_code: String::new(), name: "Cédula (ajustada)".into(), is_active: false }.validated().unwrap()).unwrap();
        save_catalog_entry(&mut conn, &CatalogEntryInput { catalog: "municipalities".into(), code: "999".into(), parent_code: "76".into(), name: "Vereda".into(), is_active: true }.validated().unwrap()).unwrap();
        save_catalog_entry(&mut conn, &CatalogEntryInput { catalog: "municipalities".into(), code: "999".into(), parent_code: "76".into(), name: "Vereda 2".into(), is_active: true }.validated().unwrap()).unwrap();
        let actions: Vec<(String, String)> = list_audit(&conn, 50).unwrap().into_iter().rev().map(|a| (a.code, a.action)).collect();
        assert_eq!(
            actions,
            vec![("99".into(), "add".into()), ("13".into(), "rename".into()), ("13".into(), "deactivate".into()), ("76999".into(), "add".into()), ("76999".into(), "rename".into())]
        );
        assert!(delete_catalog_entry(&mut conn, "document_types", "13", "").unwrap_err().0.contains("sistema"));
        assert!(delete_catalog_entry(&mut conn, "departments", "76", "").is_err());
        delete_catalog_entry(&mut conn, "document_types", "99", "").unwrap();
        delete_catalog_entry(&mut conn, "municipalities", "999", "76").unwrap();
        // Una entrada propia en uso no se elimina.
        save_catalog_entry(&mut conn, &CatalogEntryInput { catalog: "document_types".into(), code: "98".into(), parent_code: String::new(), name: "Otro".into(), is_active: true }.validated().unwrap()).unwrap();
        conn.execute("INSERT INTO suppliers (nit, business_name, doc_type_code, created_at, updated_at) VALUES ('1', 'X', '98', 'x', 'x')", []).unwrap();
        assert!(delete_catalog_entry(&mut conn, "document_types", "98", "").unwrap_err().0.contains("usan"));
        let catalogs = list_catalogs(&conn).unwrap();
        assert!(!catalogs.document_types.iter().find(|t| t.code == "13").unwrap().is_active);
        assert_eq!(catalogs.version, "2025.1");
        assert!(CatalogEntryInput { catalog: "departments".into(), code: "7".into(), parent_code: String::new(), name: "X".into(), is_active: true }.validated().is_err(), "los códigos conservan sus ceros: 2 dígitos");
    }

    #[test]
    fn not_applicable_needs_a_justification() {
        let conn = db();
        assert!(set_status(&conn, 1, 2025, "1010", "no_aplica", "  ").is_err());
        assert!(set_status(&conn, 1, 2025, "1010", "otro", "").is_err());
        set_status(&conn, 1, 2025, "1010", "no_aplica", "La empresa no tiene socios distintos").unwrap();
        let s = &list_status(&conn, 1, 2025).unwrap()[0];
        assert_eq!((s.status.as_str(), s.not_applicable_reason.as_str()), ("no_aplica", "La empresa no tiene socios distintos"));
        set_status(&conn, 1, 2025, "1010", "en_preparacion", "").unwrap();
        assert_eq!(list_status(&conn, 1, 2025).unwrap()[0].not_applicable_reason, "", "la justificación solo vive con «No aplica»");
        assert!(set_status(&conn, 99, 2025, "1010", "listo", "").is_err());
    }

    #[test]
    fn syncing_twice_does_not_duplicate_and_counts_only_real_records() {
        let mut conn = db();
        let p = vec![proposal("shareholder:1", json!({"name": "ANA", "pct": 60})), proposal("shareholder:2", json!({"name": "LUIS", "pct": 40}))];
        let first = apply_sync(&mut conn, &input(p.clone())).unwrap();
        assert_eq!((first.created, first.updated, first.unchanged), (2, 0, 0));
        let second = apply_sync(&mut conn, &input(p)).unwrap();
        assert_eq!((second.created, second.updated, second.unchanged, second.removed), (0, 0, 2, 0));
        assert_eq!(list_records(&conn, 1, 2025, "1010").unwrap().len(), 2);
        assert_eq!(record_counts(&conn, 1, 2025).unwrap(), vec![("1010".to_string(), 2)]);
        assert_eq!(list_status(&conn, 1, 2025).unwrap()[0].record_count, 2);
        assert_eq!(list_sync_runs(&conn, 1, 2025, 10).unwrap().len(), 2, "cada sincronización queda en la bitácora");
        // Otro año es otro conjunto.
        assert!(list_records(&conn, 1, 2026, "1010").unwrap().is_empty());
    }

    #[test]
    fn manual_corrections_survive_sync_unless_the_user_confirms() {
        let mut conn = db();
        apply_sync(&mut conn, &input(vec![proposal("shareholder:1", json!({"name": "ANA", "address": "CL 1", "pct": 100}))])).unwrap();
        let id = list_records(&conn, 1, 2025, "1010").unwrap()[0].id;
        set_status(&conn, 1, 2025, "1010", "listo", "").unwrap();
        let edited = update_record(&mut conn, id, &json!({"address": "CL 2 CORREGIDA"})).unwrap();
        assert_eq!(edited.manual_fields, vec!["address".to_string()]);
        assert!(edited.manually_modified_at.is_some());
        assert_eq!(list_status(&conn, 1, 2025).unwrap()[0].status, "requiere_actualizacion", "editar un formato listo lo reabre");

        // La fuente cambia dirección y nombre: el nombre se actualiza, la dirección corregida se conserva y se avisa.
        let out = apply_sync(&mut conn, &input(vec![proposal("shareholder:1", json!({"name": "ANA MARIA", "address": "CL 9", "pct": 100}))])).unwrap();
        assert_eq!((out.updated, out.conflicts.len()), (1, 1));
        assert_eq!(out.conflicts[0], SyncConflict { source_key: "shareholder:1".into(), fields: vec!["address".into()] });
        let r = &list_records(&conn, 1, 2025, "1010").unwrap()[0];
        assert_eq!((r.data["name"].as_str(), r.data["address"].as_str()), (Some("ANA MARIA"), Some("CL 2 CORREGIDA")));

        // Con confirmación se vuelve al valor de la fuente y se limpia la marca manual.
        let mut confirm = input(vec![proposal("shareholder:1", json!({"name": "ANA MARIA", "address": "CL 9", "pct": 100}))]);
        confirm.overwrite_manual = vec!["shareholder:1".into()];
        apply_sync(&mut conn, &confirm).unwrap();
        let r = &list_records(&conn, 1, 2025, "1010").unwrap()[0];
        assert_eq!(r.data["address"], "CL 9");
        assert!(r.manual_fields.is_empty() && r.manually_modified_at.is_none());
    }

    #[test]
    fn dian_1317_manual_balance_survives_sync_when_the_favor_balances_disappear() {
        let mut conn = db();
        let key = "dian-cxc:800197268";
        let sync = |conn: &mut Connection, balance: i64, trace: Value, overwrite: bool| {
            let mut i = input(vec![proposal(key, json!({"concept": "1317", "balance": balance, "taxTrace": trace}))]);
            i.format_code = "1008".into();
            if overwrite {
                i.overwrite_manual = vec![key.into()];
            }
            apply_sync(conn, &i).unwrap()
        };
        let record = |conn: &Connection| list_records(conn, 1, 2025, "1008").unwrap().into_iter().next().unwrap();

        // Sin cambios manuales: el registro automático se actualiza, con su desglose.
        sync(&mut conn, 1_500_000, json!([{"kind": "vat_favor", "resultCents": 30_000_000}, {"kind": "income_favor", "resultCents": 120_000_000}]), false);
        let out = sync(&mut conn, 1_600_000, json!([{"kind": "vat_favor", "resultCents": 40_000_000}, {"kind": "income_favor", "resultCents": 120_000_000}]), false);
        assert_eq!((out.updated, out.conflicts.len()), (1, 0));
        assert_eq!(record(&conn).data["balance"], 1_600_000);

        // El usuario edita el saldo.
        let id = record(&conn).id;
        update_record(&mut conn, id, &json!({"balance": 2_000_000})).unwrap();
        assert_eq!(record(&conn).manual_fields, vec!["balance".to_string()]);

        // Desaparecen los saldos a favor: la propuesta es $0 con desglose vacío. Se conserva el valor manual,
        // se avisa el conflicto y el desglose sí se actualiza.
        let out = sync(&mut conn, 0, json!([]), false);
        assert_eq!(out.conflicts, vec![SyncConflict { source_key: key.into(), fields: vec!["balance".into()] }]);
        let r = record(&conn);
        assert_eq!(r.data["balance"], 2_000_000);
        assert_eq!(r.data["taxTrace"], json!([]));
        assert_eq!(r.manual_fields, vec!["balance".to_string()]);

        // Reemplazo explícitamente confirmado: vuelve al cálculo ($0) y se limpia la marca manual.
        let out = sync(&mut conn, 0, json!([]), true);
        assert_eq!(out.conflicts.len(), 0);
        let r = record(&conn);
        assert_eq!(r.data["balance"], 0);
        assert!(r.manual_fields.is_empty() && r.manually_modified_at.is_none());
    }

    #[test]
    fn records_missing_from_the_source_are_removed_unless_manually_corrected() {
        let mut conn = db();
        apply_sync(&mut conn, &input(vec![proposal("a", json!({"v": 1})), proposal("b", json!({"v": 2})), proposal("c", json!({"v": 3}))])).unwrap();
        let b = list_records(&conn, 1, 2025, "1010").unwrap().into_iter().find(|r| r.source_key == "b").unwrap().id;
        update_record(&mut conn, b, &json!({"v": 20})).unwrap();
        let out = apply_sync(&mut conn, &input(vec![proposal("a", json!({"v": 1}))])).unwrap();
        assert_eq!((out.removed, out.kept_manual_orphans.clone()), (1, vec!["b".to_string()]));
        let keys: Vec<String> = list_records(&conn, 1, 2025, "1010").unwrap().into_iter().map(|r| r.source_key).collect();
        assert_eq!(keys, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn manual_records_are_separate_from_synced_ones() {
        let mut conn = db();
        apply_sync(&mut conn, &input(vec![proposal("a", json!({"v": 1}))])).unwrap();
        let manual = create_manual_record(&mut conn, 1, 2025, "1010", &json!({"v": 7})).unwrap();
        assert_eq!(manual.origin, "manual");
        // Sincronizar con remove_missing no toca el registro manual.
        apply_sync(&mut conn, &input(vec![proposal("a", json!({"v": 1}))])).unwrap();
        assert_eq!(list_records(&conn, 1, 2025, "1010").unwrap().len(), 2);
        let synced = list_records(&conn, 1, 2025, "1010").unwrap().into_iter().find(|r| r.origin == "empresas").unwrap().id;
        assert!(delete_record(&mut conn, synced).is_err());
        delete_record(&mut conn, manual.id).unwrap();
        assert_eq!(list_records(&conn, 1, 2025, "1010").unwrap().len(), 1);
    }

    #[test]
    fn invalid_sync_input_is_rejected() {
        let dup = input(vec![proposal("a", json!({})), proposal("a", json!({}))]);
        assert!(dup.validated().is_err());
        let mut bad_origin = input(vec![proposal("a", json!({}))]);
        bad_origin.proposals[0].origin = "manual".into();
        assert!(bad_origin.validated().is_err());
        let mut not_object = input(vec![proposal("a", json!([1]))]);
        assert!(not_object.clone().validated().is_err());
        not_object.proposals.clear();
        assert!(ApplySyncInput { year: 1999, ..not_object }.validated().is_err());
    }

    #[test]
    fn changing_shareholders_reopens_a_ready_1010_without_touching_its_records() {
        let mut conn = db();
        conn.execute("UPDATE companies SET subscribed_total_shares = 100, subscribed_nominal_value = 1000 WHERE id = 1", []).unwrap();
        conn.execute("INSERT INTO shareholders (id, company_id, name, identity_document, percentage, sort_order, created_at, updated_at) VALUES (1, 1, 'ANA', 'CC 1', 100, 0, 'x', 'x')", []).unwrap();
        let mut sync = input(vec![proposal("shareholder:1", json!({"name": "ANA"}))]);
        sync.source_fingerprint = Some(source_fingerprint(&conn, 1).unwrap());
        apply_sync(&mut conn, &sync).unwrap();
        set_status(&conn, 1, 2025, "1010", "listo", "").unwrap();
        flag_stale_shareholder_formats(&conn, 1).unwrap();
        assert_eq!(list_status(&conn, 1, 2025).unwrap()[0].status, "listo", "sin cambios en el origen sigue listo");
        let before = list_records(&conn, 1, 2025, "1010").unwrap();

        conn.execute("UPDATE shareholders SET address = 'CL NUEVA 5' WHERE id = 1", []).unwrap();
        flag_stale_shareholder_formats(&conn, 1).unwrap();
        assert_eq!(list_status(&conn, 1, 2025).unwrap()[0].status, "requiere_actualizacion");
        assert_eq!(list_records(&conn, 1, 2025, "1010").unwrap(), before, "no se reescribe en silencio");
        // «No aplica» no se reabre.
        set_status(&conn, 1, 2025, "1010", "no_aplica", "no aplica este año").unwrap();
        conn.execute("UPDATE shareholders SET address = 'OTRA' WHERE id = 1", []).unwrap();
        flag_stale_shareholder_formats(&conn, 1).unwrap();
        assert_eq!(list_status(&conn, 1, 2025).unwrap()[0].status, "no_aplica");
    }
}
