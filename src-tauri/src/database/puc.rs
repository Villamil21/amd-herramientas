//! Estados Financieros → Códigos PUC por factura y Tabla de Códigos PUC.
//!
//! - `puc_codes`: catálogo del PUC, sembrado por la migración 010. Nunca se
//!   modifica: el concepto propio y el estado (activo / inactivo) que el
//!   usuario da a una cuenta oficial viven en `puc_official_overrides`.
//! - `puc_document_title_mappings`: título de documento → Factura electrónica
//!   / Nota crédito. Misma forma que los títulos de IVA de compras, pero en su
//!   propia tabla: una decisión en un módulo no cambia el otro.
//! - `puc_custom_codes`: códigos personalizados (globales). Solo existen si el
//!   usuario los creó con su concepto y su padre (salvo 7305 NO APLICA). Se
//!   eliminan o cambian de número solo si no tienen ninguna referencia (`usage`).
//! - `puc_code_events`: cada edición, cambio de número, (des)activación o
//!   eliminación, con los datos antes y después.
//! - `supplier_puc_codes`: códigos que el usuario ha confirmado para cada
//!   proveedor registrado (por su id). Son accesos rápidos: nunca se asignan solos.
//!   La migración 014 reinició este historial (las filas anteriores quedan archivadas).

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::models::puc::{CustomPucCodeInput, PucCode, PucCodeUpdateInput, PucUsage, PucUsageItem, SupplierPucCode};
use crate::models::clean;
use crate::models::withholding::{DocumentTitleMapping, DocumentTitleMappingInput};
use crate::services::time::now_iso;

/// Catálogo oficial en el orden del PUC, con la denominación del catálogo: como texto, «1» < «11» < «1105» < «110505».
pub fn list_codes(conn: &Connection) -> AppResult<Vec<PucCode>> {
    let mut stmt = conn.prepare("SELECT code, concept FROM puc_codes ORDER BY code")?;
    let rows = stmt
        .query_map([], |r| Ok(PucCode { code: r.get(0)?, concept: r.get(1)?, custom: false, parent_code: None, active: true, official_concept: None }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Oficial (con los ajustes del usuario) + personalizados, en el orden del PUC.
pub fn list_all_codes(conn: &Connection) -> AppResult<Vec<PucCode>> {
    let mut stmt = conn.prepare(
        "SELECT p.code, COALESCE(o.concept, p.concept), p.concept, COALESCE(o.is_active, 1), o.concept IS NOT NULL
         FROM puc_codes p LEFT JOIN puc_official_overrides o ON o.code = p.code ORDER BY p.code",
    )?;
    let mut rows = stmt
        .query_map([], |r| {
            let renamed: bool = r.get(4)?;
            Ok(PucCode { code: r.get(0)?, concept: r.get(1)?, custom: false, parent_code: None, active: r.get(3)?, official_concept: if renamed { Some(r.get(2)?) } else { None } })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare("SELECT code, concept, parent_code, is_active FROM puc_custom_codes ORDER BY code")?;
    let custom = stmt
        .query_map([], |r| Ok(PucCode { code: r.get(0)?, concept: r.get(1)?, custom: true, parent_code: Some(r.get(2)?), active: r.get(3)?, official_concept: None }))?
        .collect::<Result<Vec<_>, _>>()?;
    rows.extend(custom);
    rows.sort_by(|a, b| a.code.cmp(&b.code));
    Ok(rows)
}

fn find_code(conn: &Connection, code: &str) -> AppResult<PucCode> {
    list_all_codes(conn)?.into_iter().find(|c| c.code == code).ok_or_else(|| AppError::user(format!("El código {code} no existe en la Tabla de Códigos PUC.")))
}

/// Concepto de un código que se puede usar en un movimiento: subcuenta oficial
/// de 6 dígitos o código personalizado guardado.
pub fn assignable_concept(conn: &Connection, code: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT COALESCE(o.concept, p.concept) FROM puc_codes p LEFT JOIN puc_official_overrides o ON o.code = p.code WHERE p.code = ?1 AND length(p.code) = 6
             UNION ALL SELECT concept FROM puc_custom_codes WHERE code = ?1",
            [code],
            |r| r.get(0),
        )
        .optional()?)
}

fn code_exists(conn: &Connection, code: &str) -> AppResult<bool> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM puc_codes WHERE code = ?1) OR EXISTS(SELECT 1 FROM puc_custom_codes WHERE code = ?1)", [code], |r| r.get(0))?)
}

/// Código de un personalizado (4 a 12 dígitos) y su padre: debe existir y ser
/// el inicio del código. `own` es el código que se está editando (no cuenta como ocupado).
fn validate_custom(conn: &Connection, code: &str, parent: &str, own: Option<&str>) -> AppResult<()> {
    if !(4..=12).contains(&code.len()) || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::user("El código debe tener entre 4 y 12 dígitos, solo números."));
    }
    if own != Some(code) && code_exists(conn, code)? {
        return Err(AppError::user(format!("El código {code} ya existe en la Tabla de Códigos PUC.")));
    }
    if parent.is_empty() || !code.starts_with(parent) || parent.len() >= code.len() {
        return Err(AppError::user("Confirma el código padre: debe ser el inicio del código nuevo (ej. 110505 para 11050501)."));
    }
    if !code_exists(conn, parent)? {
        return Err(AppError::user(format!("El código padre {parent} no existe en la Tabla de Códigos PUC.")));
    }
    Ok(())
}

/// Crea un código personalizado. El concepto lo escribe el usuario y el padre lo
/// confirma él: debe existir (oficial o personalizado) y ser el inicio del código.
pub fn create_custom_code(conn: &Connection, input: &CustomPucCodeInput) -> AppResult<PucCode> {
    let code: String = input.code.chars().filter(|c| !c.is_whitespace()).collect();
    let concept = clean(&input.concept, 200);
    let parent = input.parent_code.trim().to_string();
    if !(4..=12).contains(&code.len()) || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::user("El código debe tener entre 4 y 12 dígitos, solo números."));
    }
    if concept.is_empty() {
        return Err(AppError::user("Escribe el concepto de la cuenta."));
    }
    validate_custom(conn, &code, &parent, None)?;
    let now = now_iso();
    conn.execute(
        "INSERT INTO puc_custom_codes (code, concept, parent_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![code, concept, parent, now],
    )?;
    Ok(PucCode { code, concept, custom: true, parent_code: Some(parent), active: true, official_concept: None })
}

// ---------------------------------------------------------------------------
// Uso de un código: qué lo referencia
// ---------------------------------------------------------------------------

type UsageMap = BTreeMap<String, BTreeMap<String, i64>>;

fn add_usage(map: &mut UsageMap, code: &str, kind: &str, n: i64) {
    if !code.is_empty() && n > 0 {
        *map.entry(code.to_string()).or_default().entry(kind.to_string()).or_default() += n;
    }
}

fn parse(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or(Value::Null)
}

/// Referencias de todos los códigos que tienen alguna. Cuenta como uso todo lo
/// que perdería trazabilidad o quedaría roto si el código desapareciera:
/// movimientos (de cualquier estado: activos, reemplazados, anulados… nunca se
/// borran, así que cubren saldos iniciales, extractos, nómina, compras, ventas,
/// ajustes y todo envío previo a Estados Financieros), reclasificaciones
/// anteriores, ajustes y su historial, borradores de saldos iniciales, saldos y
/// cuentas bancarias, conceptos bancarios, cuentas configuradas (nómina,
/// ventas, obligaciones tributarias…), proveedores y códigos personalizados
/// que lo tienen como padre. Su propia clasificación en EEFF no es un uso.
fn usage_all(conn: &Connection) -> AppResult<UsageMap> {
    let mut map = UsageMap::new();
    let mut stmt = conn.prepare("SELECT puc_code, source, COUNT(*) FROM fs_movements GROUP BY puc_code, source")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))? {
        let (code, source, n) = row?;
        add_usage(&mut map, &code, &format!("movements:{source}"), n);
    }
    for (table, kind) in [
        ("fs_adjustments", "adjustments"),
        ("fs_bank_balances", "bank_balances"),
        ("fs_bank_accounts", "bank_accounts"),
        ("fs_bank_concept_mappings", "bank_concepts"),
        ("fs_puc_settings", "puc_settings"),
        ("supplier_puc_codes", "suppliers"),
    ] {
        let mut stmt = conn.prepare(&format!("SELECT puc_code, COUNT(*) FROM {table} GROUP BY puc_code"))?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (code, n) = row?;
            add_usage(&mut map, &code, kind, n);
        }
    }
    let mut stmt = conn.prepare("SELECT parent_code, COUNT(*) FROM puc_custom_codes WHERE parent_code <> '' GROUP BY parent_code")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
        let (code, n) = row?;
        add_usage(&mut map, &code, "children", n);
    }
    // Movimientos reclasificados: el código anterior queda en su historial.
    let mut stmt = conn.prepare("SELECT puc_code, detail FROM fs_movements WHERE instr(detail, '\"reclassified\"') > 0")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (current, detail) = row?;
        let mut codes = BTreeSet::new();
        for step in parse(&detail)["reclassified"].as_array().into_iter().flatten() {
            for key in ["from", "to"] {
                if let Some(c) = step[key].as_str().filter(|c| *c != current) {
                    codes.insert(c.to_string());
                }
            }
        }
        for c in codes {
            add_usage(&mut map, &c, "reclassified", 1);
        }
    }
    // Ajustes editados: el código que tenían antes queda en su historial.
    let mut stmt = conn.prepare("SELECT h.adjustment_id, h.previous, a.puc_code FROM fs_adjustment_history h JOIN fs_adjustments a ON a.id = h.adjustment_id")?;
    let mut seen = BTreeSet::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
        let (id, previous, current) = row?;
        if let Some(code) = parse(&previous)["pucCode"].as_str().map(str::to_string).filter(|p| *p != current) {
            if seen.insert((id, code.clone())) {
                add_usage(&mut map, &code, "adjustments", 1);
            }
        }
    }
    // Borradores de saldos iniciales (aún sin enviar).
    let mut stmt = conn.prepare("SELECT rows FROM fs_opening_drafts")?;
    for rows in stmt.query_map([], |r| r.get::<_, String>(0))? {
        let codes: BTreeSet<String> = parse(&rows?).as_array().into_iter().flatten().filter_map(|r| r["pucCode"].as_str().map(|c| c.trim().to_string())).collect();
        for c in codes {
            add_usage(&mut map, &c, "opening_drafts", 1);
        }
    }
    Ok(map)
}

fn to_usage(code: &str, kinds: Option<&BTreeMap<String, i64>>) -> PucUsage {
    let items: Vec<PucUsageItem> = kinds.into_iter().flatten().map(|(kind, count)| PucUsageItem { kind: kind.clone(), count: *count }).collect();
    PucUsage { code: code.to_string(), total: items.iter().map(|i| i.count).sum(), items }
}

/// Todos los códigos con alguna referencia (para la columna «En uso»).
pub fn list_usage(conn: &Connection) -> AppResult<Vec<PucUsage>> {
    Ok(usage_all(conn)?.iter().map(|(code, kinds)| to_usage(code, Some(kinds))).collect())
}

/// Referencias de un código (vacío si no tiene ninguna).
pub fn code_usage(conn: &Connection, code: &str) -> AppResult<PucUsage> {
    Ok(to_usage(code, usage_all(conn)?.get(code)))
}

// ---------------------------------------------------------------------------
// Administración de la tabla
// ---------------------------------------------------------------------------

pub const IN_USE_RECODE: &str = "Este código PUC ya tiene movimientos o referencias asociadas y no puede cambiarse directamente.\nCrea un nuevo PUC y reclasifica explícitamente si necesitas usar otro código.";
pub const IN_USE_DELETE: &str = "Este código PUC ya tiene movimientos o referencias asociadas y no puede eliminarse.\nPuedes desactivarlo para que no aparezca en nuevas selecciones.";

fn snapshot(c: &PucCode) -> Value {
    json!({ "code": c.code, "concept": c.concept, "parentCode": c.parent_code, "active": c.active, "custom": c.custom })
}

fn record_event(conn: &Connection, code: &str, action: &str, previous: &Value, next: &Value) -> AppResult<()> {
    conn.execute(
        "INSERT INTO puc_code_events (code, action, previous, next, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![code, action, previous.to_string(), next.to_string(), now_iso()],
    )?;
    Ok(())
}

/// Edita una fila. El concepto nunca toca los movimientos ya enviados (guardan
/// el suyo) ni la clasificación. En una cuenta oficial solo cambia el concepto
/// (vacío = la denominación oficial). En una personalizada también el padre y,
/// solo si el código no tiene ninguna referencia, el número: su clasificación
/// en EEFF pasa al número nuevo.
pub fn update_code(conn: &mut Connection, input: &PucCodeUpdateInput) -> AppResult<PucCode> {
    let code = input.code.trim();
    let before = find_code(conn, code)?;
    let concept = clean(&input.concept, 200);
    let new_code: String = input.new_code.as_deref().unwrap_or(code).chars().filter(|c| !c.is_whitespace()).collect();
    let tx = conn.transaction()?;
    let now = now_iso();

    if !before.custom {
        if new_code != code {
            return Err(AppError::user("El número de una cuenta oficial del PUC no se puede cambiar. Crea un código personalizado si necesitas otro."));
        }
        let official = before.official_concept.clone().unwrap_or_else(|| before.concept.clone());
        // Vacío o igual al oficial: se vuelve a la denominación del catálogo.
        let own = (!concept.is_empty() && concept != official).then_some(concept.clone());
        tx.execute(
            "INSERT INTO puc_official_overrides (code, concept, is_active, updated_at) VALUES (?1, ?2, 1, ?3)
             ON CONFLICT(code) DO UPDATE SET concept = excluded.concept, updated_at = excluded.updated_at",
            params![code, own, now],
        )?;
    } else {
        if concept.is_empty() {
            return Err(AppError::user("Escribe el concepto de la cuenta."));
        }
        let parent = input.parent_code.as_deref().map(str::trim).unwrap_or(before.parent_code.as_deref().unwrap_or("")).to_string();
        if new_code != code && code_usage(&tx, code)?.total > 0 {
            return Err(AppError::user(IN_USE_RECODE));
        }
        validate_custom(&tx, &new_code, &parent, Some(code))?;
        tx.execute(
            "UPDATE puc_custom_codes SET code = ?1, concept = ?2, parent_code = ?3, updated_at = ?4 WHERE code = ?5",
            params![new_code, concept, parent, now, code],
        )?;
        if new_code != code {
            tx.execute("UPDATE fs_puc_mappings SET puc_code = ?1, updated_at = ?2 WHERE puc_code = ?3", params![new_code, now, code])?;
        }
    }
    let after = find_code(&tx, &new_code)?;
    if snapshot(&after) != snapshot(&before) {
        record_event(&tx, code, if new_code != code { "recoded" } else { "edited" }, &snapshot(&before), &snapshot(&after))?;
    }
    tx.commit()?;
    Ok(after)
}

/// Activa o desactiva un código asignable (subcuenta oficial de 6 dígitos o
/// personalizado). No toca movimientos, mapeos ni configuraciones.
pub fn set_code_active(conn: &mut Connection, code: &str, active: bool) -> AppResult<PucCode> {
    let code = code.trim();
    let before = find_code(conn, code)?;
    if !before.custom && code.len() != 6 {
        return Err(AppError::user("Solo se desactivan las subcuentas de 6 dígitos y los códigos personalizados."));
    }
    if before.active == active {
        return Ok(before);
    }
    let tx = conn.transaction()?;
    let now = now_iso();
    if before.custom {
        tx.execute("UPDATE puc_custom_codes SET is_active = ?1, updated_at = ?2 WHERE code = ?3", params![active, now, code])?;
    } else {
        tx.execute(
            "INSERT INTO puc_official_overrides (code, concept, is_active, updated_at) VALUES (?1, NULL, ?2, ?3)
             ON CONFLICT(code) DO UPDATE SET is_active = excluded.is_active, updated_at = excluded.updated_at",
            params![code, active, now],
        )?;
    }
    let after = find_code(&tx, code)?;
    record_event(&tx, code, if active { "reactivated" } else { "deactivated" }, &snapshot(&before), &snapshot(&after))?;
    tx.commit()?;
    Ok(after)
}

/// Elimina físicamente un código personalizado sin ninguna referencia. Su
/// clasificación en EEFF (si tenía) se va con él; su historial se conserva.
pub fn delete_custom_code(conn: &mut Connection, code: &str) -> AppResult<()> {
    let code = code.trim();
    let before = find_code(conn, code)?;
    if !before.custom {
        return Err(AppError::user("Las cuentas oficiales del PUC no se pueden eliminar. Puedes desactivarlas para que no aparezcan en nuevas selecciones."));
    }
    let tx = conn.transaction()?;
    if code_usage(&tx, code)?.total > 0 {
        return Err(AppError::user(IN_USE_DELETE));
    }
    let mapping: Option<(Option<i64>, bool)> = tx.query_row("SELECT line_id, excluded FROM fs_puc_mappings WHERE puc_code = ?1", [code], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    let mut previous = snapshot(&before);
    if let (Value::Object(map), Some((line_id, excluded))) = (&mut previous, mapping) {
        map.insert("mapping".into(), json!({ "lineId": line_id, "excluded": excluded }));
    }
    tx.execute("DELETE FROM fs_puc_mappings WHERE puc_code = ?1", [code])?;
    tx.execute("DELETE FROM puc_custom_codes WHERE code = ?1", [code])?;
    record_event(&tx, code, "deleted", &previous, &json!({}))?;
    tx.commit()?;
    Ok(())
}

const COLUMNS: &str = "id, normalized_title, display_title, category, created_at, updated_at";

fn map(r: &Row) -> rusqlite::Result<DocumentTitleMapping> {
    Ok(DocumentTitleMapping {
        id: r.get(0)?,
        normalized_title: r.get(1)?,
        display_title: r.get(2)?,
        category: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn list_titles(conn: &Connection) -> AppResult<Vec<DocumentTitleMapping>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM puc_document_title_mappings ORDER BY normalized_title"))?;
    let rows = stmt.query_map([], map)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Crea o actualiza (por título normalizado) varias clasificaciones: todas o ninguna.
pub fn save_titles(conn: &mut Connection, items: &[DocumentTitleMappingInput]) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_iso();
    for m in items {
        tx.execute(
            "INSERT INTO puc_document_title_mappings (normalized_title, display_title, category, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(normalized_title) DO UPDATE SET
                display_title = excluded.display_title,
                category = excluded.category,
                updated_at = excluded.updated_at",
            params![m.normalized_title, m.display_title, m.category, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn update_title_category(conn: &Connection, id: i64, category: &str) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE puc_document_title_mappings SET category = ?1, updated_at = ?2 WHERE id = ?3",
        params![category, now_iso(), id],
    )?;
    if n == 0 {
        return Err(AppError::user("La clasificación no existe o fue eliminada."));
    }
    Ok(())
}

pub fn delete_title(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM puc_document_title_mappings WHERE id = ?1", [id])?;
    Ok(())
}

pub fn insert_title_full(conn: &Connection, m: &DocumentTitleMapping) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO puc_document_title_mappings ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
        params![m.id, m.normalized_title, m.display_title, m.category, m.created_at, m.updated_at],
    )?;
    Ok(())
}

/// Códigos confirmados para un proveedor, del usado más recientemente al más antiguo.
pub fn list_supplier_codes(conn: &Connection, supplier_id: i64) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT puc_code FROM supplier_puc_codes WHERE supplier_id = ?1 ORDER BY last_used_at DESC, id DESC")?;
    let rows = stmt.query_map([supplier_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Asocia un código al proveedor. Si ya lo tenía no se duplica: se actualizan
/// la fecha de último uso y el contador. Solo admite subcuentas de 6 dígitos del
/// catálogo o códigos personalizados, y proveedores registrados.
pub fn record_supplier_code(conn: &Connection, supplier_id: i64, code: &str) -> AppResult<()> {
    record_supplier_code_at(conn, supplier_id, code, &now_iso())
}

fn record_supplier_code_at(conn: &Connection, supplier_id: i64, code: &str, now: &str) -> AppResult<()> {
    if assignable_concept(conn, code)?.is_none() {
        return Err(AppError::user("No se puede asignar este nivel del PUC. Selecciona un código de 6 dígitos o un código personalizado."));
    }
    let registered: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM suppliers WHERE id = ?1)", [supplier_id], |r| r.get(0))?;
    if !registered {
        return Err(AppError::user("El proveedor no existe o fue eliminado."));
    }
    conn.execute(
        "INSERT INTO supplier_puc_codes (supplier_id, puc_code, usage_count, created_at, last_used_at)
         VALUES (?1, ?2, 1, ?3, ?3)
         ON CONFLICT(supplier_id, puc_code) DO UPDATE SET
            usage_count = usage_count + 1,
            last_used_at = excluded.last_used_at",
        params![supplier_id, code, now],
    )?;
    Ok(())
}

/// Quita una asociación de sugerencia proveedor ↔ código (no toca movimientos ya enviados).
pub fn delete_supplier_code(conn: &Connection, supplier_id: i64, code: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM supplier_puc_codes WHERE supplier_id = ?1 AND puc_code = ?2", params![supplier_id, code])? == 0 {
        return Err(AppError::user("Esa asociación ya no existe."));
    }
    Ok(())
}

/// Cambia el código de una asociación de sugerencia (conserva el contador de usos).
pub fn replace_supplier_code(conn: &mut Connection, supplier_id: i64, from: &str, to: &str) -> AppResult<()> {
    if from == to {
        return Ok(());
    }
    if assignable_concept(conn, to)?.is_none() {
        return Err(AppError::user("No se puede asignar este nivel del PUC. Selecciona un código de 6 dígitos o un código personalizado."));
    }
    let tx = conn.transaction()?;
    let row: Option<(i64, String)> = tx
        .query_row("SELECT usage_count, created_at FROM supplier_puc_codes WHERE supplier_id = ?1 AND puc_code = ?2", params![supplier_id, from], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let Some((count, created)) = row else { return Err(AppError::user("Esa asociación ya no existe.")) };
    tx.execute("DELETE FROM supplier_puc_codes WHERE supplier_id = ?1 AND puc_code = ?2", params![supplier_id, from])?;
    tx.execute(
        "INSERT INTO supplier_puc_codes (supplier_id, puc_code, usage_count, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(supplier_id, puc_code) DO UPDATE SET usage_count = usage_count + excluded.usage_count",
        params![supplier_id, to, count, created, now_iso()],
    )?;
    tx.commit()?;
    Ok(())
}

/// Todas las asociaciones proveedor ↔ código, con el NIT del proveedor (backup).
pub fn list_all_supplier_codes(conn: &Connection) -> AppResult<Vec<SupplierPucCode>> {
    let mut stmt = conn.prepare(
        "SELECT s.nit, c.puc_code, c.usage_count, c.created_at, c.last_used_at
         FROM supplier_puc_codes c JOIN suppliers s ON s.id = c.supplier_id ORDER BY c.id",
    )?;
    let rows = stmt
        .query_map([], |r| Ok(SupplierPucCode { supplier_nit: r.get(0)?, puc_code: r.get(1)?, usage_count: r.get(2)?, created_at: r.get(3)?, last_used_at: r.get(4)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Restauración de backup: el proveedor se localiza por NIT. Se omite, sin
/// fallar, una asociación repetida, de un proveedor que no está o cuyo código
/// no sea asignable en esta versión. Devuelve si se insertó.
pub fn insert_supplier_code_full(conn: &Connection, c: &SupplierPucCode) -> AppResult<bool> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO supplier_puc_codes (supplier_id, puc_code, usage_count, created_at, last_used_at)
         SELECT s.id, ?2, ?3, ?4, ?5 FROM suppliers s
         WHERE s.nit = ?1 AND (EXISTS (SELECT 1 FROM puc_codes WHERE code = ?2 AND length(code) = 6) OR EXISTS (SELECT 1 FROM puc_custom_codes WHERE code = ?2))",
        params![c.supplier_nit, c.puc_code, c.usage_count.max(1), c.created_at, c.last_used_at],
    )?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;
    use crate::database::vat_titles;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        conn
    }

    fn concept(codes: &[PucCode], code: &str) -> Option<String> {
        codes.iter().find(|c| c.code == code).map(|c| c.concept.clone())
    }

    #[test]
    fn seeds_the_catalog_in_puc_order() {
        let codes = list_codes(&db()).unwrap();
        assert_eq!(codes.len(), 2517);
        // Puntos de control del catálogo fuente (páginas 5 y 115).
        let head: Vec<(&str, &str)> = codes.iter().take(5).map(|c| (c.code.as_str(), c.concept.as_str())).collect();
        assert_eq!(head, [("1", "ACTIVO"), ("11", "DISPONIBLE"), ("1105", "CAJA"), ("110505", "CAJA GENERAL"), ("110510", "CAJAS MENORES")]);
        let last = codes.last().unwrap();
        assert_eq!((last.code.as_str(), last.concept.as_str()), ("96", "ACREEDORAS DE CONTROL POR CONTRA (DB)"));
        assert_eq!(concept(&codes, "1110").as_deref(), Some("BANCOS"));
        assert_eq!(concept(&codes, "111005").as_deref(), Some("MONEDA NACIONAL"));
        // Filas que en el PDF vienen pegadas o con la denominación desfasada.
        assert_eq!(concept(&codes, "125040").as_deref(), Some("ACEPTACIONES BANCARIAS O FINANCIERAS"));
        assert_eq!(concept(&codes, "125095").as_deref(), Some("OTROS"));
        assert_eq!(concept(&codes, "171068").as_deref(), Some("LOZA Y CRISTALERIA"));
        assert_eq!(concept(&codes, "1455").as_deref(), Some("MATERIALES, REPUESTOS Y ACCESORIOS"));
    }

    #[test]
    fn catalog_has_no_ranges_notes_or_invented_codes() {
        let codes = list_codes(&db()).unwrap();
        let count = |len: usize| codes.iter().filter(|c| c.code.len() == len).count();
        assert_eq!((count(1), count(2), count(4), count(6)), (9, 51, 338, 2119));
        for c in &codes {
            assert!(c.code.chars().all(|ch| ch.is_ascii_digit()), "{}", c.code);
            assert!(!c.concept.trim().is_empty(), "{} sin denominación", c.code);
            let upper = c.concept.to_uppercase();
            for note in ["D.R.", "ART.", "REPLANTEAD", "ADICIONAD", "ELIMINAD", "REDENOMINAD", "RECODIFICAD", "NUEVA DENOMINACI"] {
                assert!(!upper.contains(note), "{} conserva una nota legal: {}", c.code, c.concept);
            }
        }
        // «126001 a 126098» no se expande: la cuenta existe, sus números intermedios no.
        assert_eq!(concept(&codes, "1260").as_deref(), Some("CUENTAS EN PARTICIPACION"));
        for code in ["126001", "126050", "126098", "960101", "9601"] {
            assert_eq!(concept(&codes, code), None, "{code}");
        }
    }

    #[test]
    fn catalog_is_read_only_and_survives_restarts() {
        let mut conn = db();
        assert!(conn.execute("INSERT INTO puc_codes (code, concept) VALUES ('12345', 'X')", []).is_err(), "solo 1, 2, 4 o 6 dígitos");
        assert!(conn.execute("INSERT INTO puc_codes (code, concept) VALUES ('11050A', 'X')", []).is_err(), "solo dígitos");
        // Segundo arranque o actualización sin migraciones nuevas: no se vuelve a sembrar ni se pierde nada.
        assert!(run_pending(&mut conn).unwrap().is_empty());
        assert_eq!(list_codes(&conn).unwrap().len(), 2517);
    }

    fn category(conn: &Connection, title: &str) -> Option<String> {
        list_titles(conn).unwrap().into_iter().find(|m| m.normalized_title == title).map(|m| m.category)
    }

    #[test]
    fn title_decisions_persist_and_do_not_touch_other_modules() {
        let mut conn = db();
        assert_eq!(category(&conn, "factura electronica de venta").as_deref(), Some("invoice"));
        assert_eq!(category(&conn, "nota de credito electronica").as_deref(), Some("credit_note"));
        assert_eq!(category(&conn, "documento xyz"), None, "un título desconocido se pregunta");

        let vat_before = vat_titles::list(&conn).unwrap().len();
        let t = |category: &str| DocumentTitleMappingInput { normalized_title: "documento xyz".into(), display_title: "DOCUMENTO XYZ".into(), category: category.into() };
        save_titles(&mut conn, &[t("credit_note")]).unwrap();
        assert!(run_pending(&mut conn).unwrap().is_empty());
        assert_eq!(category(&conn, "documento xyz").as_deref(), Some("credit_note"));
        let saved = list_titles(&conn).unwrap().into_iter().find(|m| m.normalized_title == "documento xyz").unwrap();
        assert_eq!(saved.display_title, "DOCUMENTO XYZ", "se conserva el título original para mostrarlo");
        update_title_category(&conn, saved.id, "invoice").unwrap();
        assert_eq!(category(&conn, "documento xyz").as_deref(), Some("invoice"));
        assert!(update_title_category(&conn, 99_999, "invoice").is_err());
        assert!(save_titles(&mut conn, &[t("otro")]).is_err(), "la tabla solo admite las dos categorías");
        delete_title(&conn, saved.id).unwrap();
        assert_eq!(category(&conn, "documento xyz"), None);
        assert_eq!(vat_titles::list(&conn).unwrap().len(), vat_before);
    }

    fn supplier(conn: &Connection, nit: &str) -> i64 {
        use crate::models::supplier::SupplierInput;
        crate::database::suppliers::insert(conn, &SupplierInput { nit: nit.into(), business_name: format!("PROVEEDOR {nit}"), vat_type: None }).unwrap()
    }

    #[test]
    fn supplier_codes_are_remembered_per_supplier_without_duplicates() {
        let mut conn = db();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let (a, b) = (supplier(&conn, "900319753"), supplier(&conn, "800123456"));
        assert!(list_supplier_codes(&conn, a).unwrap().is_empty(), "un proveedor nuevo no trae códigos de otros");

        record_supplier_code_at(&conn, a, "513595", "2026-10-01T10:00:00Z").unwrap();
        record_supplier_code_at(&conn, a, "514010", "2026-10-01T10:05:00Z").unwrap();
        record_supplier_code_at(&conn, b, "110505", "2026-10-01T10:06:00Z").unwrap();
        assert_eq!(list_supplier_codes(&conn, a).unwrap(), ["514010", "513595"], "el más reciente primero");
        assert_eq!(list_supplier_codes(&conn, b).unwrap(), ["110505"], "solo los del proveedor");

        // Reutilizar un código no lo duplica: sube al principio y cuenta el uso.
        record_supplier_code_at(&conn, a, "513595", "2026-10-02T09:00:00Z").unwrap();
        assert_eq!(list_supplier_codes(&conn, a).unwrap(), ["513595", "514010"]);
        let saved = list_all_supplier_codes(&conn).unwrap();
        assert_eq!(saved.len(), 3);
        let reused = saved.iter().find(|c| c.supplier_nit == "900319753" && c.puc_code == "513595").unwrap();
        assert_eq!((reused.usage_count, reused.created_at.as_str(), reused.last_used_at.as_str()), (2, "2026-10-01T10:00:00Z", "2026-10-02T09:00:00Z"));

        // Solo subcuentas de 6 dígitos que existan en la tabla: nunca una cuenta de 4 (5135, 1105) ni un grupo.
        for bad in ["5135", "1105", "11", "999999", "", "51359A"] {
            assert!(record_supplier_code(&conn, a, bad).unwrap_err().0.contains("código de 6 dígitos"), "{bad}");
        }
        assert!(conn.execute("INSERT INTO supplier_puc_codes (supplier_id, puc_code, created_at, last_used_at) VALUES (?1, '51A5', 'x', 'x')", [a]).is_err());
        // Solo contra un proveedor registrado: sin él no se guarda nada.
        assert!(record_supplier_code(&conn, 99_999, "513595").is_err());
        assert_eq!(list_all_supplier_codes(&conn).unwrap().len(), 3);

        // Segundo arranque o actualización: se conservan.
        assert!(run_pending(&mut conn).unwrap().is_empty());
        assert_eq!(list_supplier_codes(&conn, a).unwrap(), ["513595", "514010"]);

        // Cambiar el NIT o la razón social no pierde el historial; eliminar el proveedor sí lo quita.
        conn.execute("UPDATE suppliers SET nit = '900319754', business_name = 'Otro Nombre' WHERE id = ?1", [a]).unwrap();
        assert_eq!(list_supplier_codes(&conn, a).unwrap().len(), 2);
        crate::database::suppliers::delete(&conn, a).unwrap();
        assert_eq!(list_all_supplier_codes(&conn).unwrap().len(), 1);
    }

    #[test]
    fn custom_codes_are_global_validated_and_assignable() {
        let mut conn = db();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        // 7305 NO APLICA viene creado (bajo 73 COSTOS INDIRECTOS) y es asignable.
        assert_eq!(assignable_concept(&conn, "7305").unwrap().as_deref(), Some("NO APLICA"));
        let input = |code: &str, concept: &str, parent: &str| CustomPucCodeInput { code: code.into(), concept: concept.into(), parent_code: parent.into() };
        let created = create_custom_code(&conn, &input("11050501", "Caja dueño", "110505")).unwrap();
        assert_eq!((created.code.as_str(), created.custom, created.parent_code.as_deref()), ("11050501", true, Some("110505")));
        // Un código oficial no existente bajo una cuenta oficial (6205 → 620501).
        create_custom_code(&conn, &input("620501", "Mercancías importadas", "6205")).unwrap();
        for (bad, why) in [
            (input("110505", "X", "1105"), "ya existe"),
            (input("11050501", "X", "110505"), "ya existe"),
            (input("11050502", "", "110505"), "concepto"),
            (input("11050502", "X", ""), "padre"),
            (input("11050502", "X", "1110"), "padre"),
            (input("99990001", "X", "9999"), "no existe"),
            (input("12A4", "X", "12"), "dígitos"),
        ] {
            let e = create_custom_code(&conn, &bad).unwrap_err().0;
            assert!(e.contains(why), "{}: {e}", bad.code);
        }
        let all = list_all_codes(&conn).unwrap();
        assert_eq!(all.len(), 2517 + 3);
        let i = all.iter().position(|c| c.code == "11050501").unwrap();
        assert_eq!((all[i - 1].code.as_str(), all[i + 1].code.as_str()), ("110505", "110510"), "en el orden del PUC");
        // Se puede usar con un proveedor y sobrevive a un nuevo arranque.
        let id = supplier(&conn, "890399003");
        record_supplier_code(&conn, id, "11050501").unwrap();
        assert!(run_pending(&mut conn).unwrap().is_empty());
        assert_eq!(list_supplier_codes(&conn, id).unwrap(), ["11050501"]);
        assert_eq!(list_codes(&conn).unwrap().len(), 2517, "el catálogo oficial no cambia");
    }

    fn custom(conn: &Connection, code: &str, concept: &str) {
        create_custom_code(conn, &CustomPucCodeInput { code: code.into(), concept: concept.into(), parent_code: "110505".into() }).unwrap();
    }

    /// Un movimiento enviado a Estados Financieros con el código.
    fn movement(conn: &Connection, code: &str) {
        conn.execute("INSERT INTO companies (razon_social, nit, created_at, updated_at) VALUES ('EMPRESA', '900' || abs(random() % 1000000), 'x', 'x')", []).unwrap();
        let company = conn.last_insert_rowid();
        conn.execute("INSERT INTO fs_batches (company_id, source, created_at, updated_at) VALUES (?1, 'purchases', 'x', 'x')", [company]).unwrap();
        let batch = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO fs_movements (company_id, batch_id, accounting_date, source, puc_code, puc_concept, amount_cents, created_at, updated_at) VALUES (?1, ?2, '2026-08-31', 'purchases', ?3, 'Cuenta usada', 100, 'x', 'x')",
            params![company, batch, code],
        )
        .unwrap();
    }

    fn update(code: &str, new_code: Option<&str>, concept: &str) -> PucCodeUpdateInput {
        PucCodeUpdateInput { code: code.into(), new_code: new_code.map(Into::into), concept: concept.into(), parent_code: None }
    }

    fn get(conn: &Connection, code: &str) -> Option<PucCode> {
        list_all_codes(conn).unwrap().into_iter().find(|c| c.code == code)
    }

    #[test]
    fn deletes_an_unused_custom_code() {
        let mut conn = db();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        custom(&conn, "11050501", "Cuenta temporal");
        assert_eq!(code_usage(&conn, "11050501").unwrap().total, 0);
        // Su propia clasificación en EEFF no es un uso: se va con el código.
        crate::database::fs::set_mapping(&mut conn, "11050501", Some(1), false).unwrap();
        delete_custom_code(&mut conn, "11050501").unwrap();
        assert!(get(&conn, "11050501").is_none(), "desaparece del catálogo");
        assert!(crate::database::fs::list_mappings(&conn).unwrap().iter().all(|m| m.puc_code != "11050501"));
        let action: String = conn.query_row("SELECT action FROM puc_code_events WHERE code = '11050501' ORDER BY id DESC", [], |r| r.get(0)).unwrap();
        assert_eq!(action, "deleted");
    }

    #[test]
    fn a_custom_code_with_movements_cannot_be_deleted_but_can_be_deactivated() {
        let mut conn = db();
        custom(&conn, "11050502", "Cuenta usada");
        movement(&conn, "11050502");
        let usage = code_usage(&conn, "11050502").unwrap();
        assert_eq!((usage.total, usage.items[0].kind.as_str()), (1, "movements:purchases"));
        let e = delete_custom_code(&mut conn, "11050502").unwrap_err().0;
        assert!(e.contains("ya tiene movimientos o referencias asociadas"), "{e}");
        assert!(get(&conn, "11050502").is_some());

        // Desactivar: deja de ser seleccionable, el movimiento conserva el código.
        assert!(!set_code_active(&mut conn, "11050502", false).unwrap().active);
        let kept: String = conn.query_row("SELECT puc_code FROM fs_movements", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "11050502");
        assert_eq!(assignable_concept(&conn, "11050502").unwrap().as_deref(), Some("Cuenta usada"), "lo histórico lo sigue leyendo");
        assert!(set_code_active(&mut conn, "11050502", true).unwrap().active, "se puede reactivar");
        let actions: Vec<String> = conn.prepare("SELECT action FROM puc_code_events WHERE code = '11050502' ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(actions, ["deactivated", "reactivated"]);
    }

    #[test]
    fn the_code_number_changes_only_without_usage() {
        let mut conn = db();
        custom(&conn, "11050503", "Sin uso");
        crate::database::fs::set_mapping(&mut conn, "11050503", Some(1), false).unwrap();
        let moved = update_code(&mut conn, &update("11050503", Some("11050504"), "Sin uso")).unwrap();
        assert_eq!(moved.code, "11050504");
        assert!(get(&conn, "11050503").is_none());
        assert!(crate::database::fs::list_mappings(&conn).unwrap().iter().any(|m| m.puc_code == "11050504" && m.line_id == Some(1)), "la clasificación pasa al número nuevo");
        // El nuevo número debe estar libre y conservar un padre válido.
        custom(&conn, "11050506", "Otra");
        assert!(update_code(&mut conn, &update("11050504", Some("11050506"), "Sin uso")).unwrap_err().0.contains("ya existe"));
        assert!(update_code(&mut conn, &update("11050504", Some("111005"), "Sin uso")).unwrap_err().0.contains("ya existe"));
        assert!(update_code(&mut conn, &update("11050504", Some("11100501"), "Sin uso")).unwrap_err().0.contains("padre"));
        assert!(update_code(&mut conn, &update("11050504", None, "  ")).unwrap_err().0.contains("concepto"));

        custom(&conn, "11050505", "Con uso");
        movement(&conn, "11050505");
        let e = update_code(&mut conn, &update("11050505", Some("11050507"), "Con uso")).unwrap_err().0;
        assert!(e.contains("no puede cambiarse directamente"), "{e}");
        // El concepto sí cambia, sin tocar el movimiento.
        assert_eq!(update_code(&mut conn, &update("11050505", None, "Con uso renombrada")).unwrap().concept, "Con uso renombrada");
        let (code, concept): (String, String) = conn.query_row("SELECT puc_code, puc_concept FROM fs_movements", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((code.as_str(), concept.as_str()), ("11050505", "Cuenta usada"));
        // Un padre con hijos personalizados también está en uso.
        assert!(code_usage(&conn, "110505").unwrap().items.iter().any(|i| i.kind == "children" && i.count == 3));
    }

    #[test]
    fn official_codes_are_never_deleted_or_renumbered() {
        let mut conn = db();
        assert!(delete_custom_code(&mut conn, "110505").unwrap_err().0.contains("no se pueden eliminar"));
        assert!(update_code(&mut conn, &update("110505", Some("110599"), "CAJA")).unwrap_err().0.contains("no se puede cambiar"));
        // Concepto propio, sin perder la denominación oficial; vacío vuelve a ella.
        let renamed = update_code(&mut conn, &update("110505", None, "Caja general principal")).unwrap();
        assert_eq!((renamed.concept.as_str(), renamed.official_concept.as_deref()), ("Caja general principal", Some("CAJA GENERAL")));
        assert_eq!(assignable_concept(&conn, "110505").unwrap().as_deref(), Some("Caja general principal"));
        let restored = update_code(&mut conn, &update("110505", None, "")).unwrap();
        assert_eq!((restored.concept.as_str(), restored.official_concept), ("CAJA GENERAL", None));
        // Desactivar una subcuenta oficial; un nivel superior no.
        assert!(!set_code_active(&mut conn, "110505", false).unwrap().active);
        assert!(set_code_active(&mut conn, "1105", false).is_err());
        assert_eq!(list_codes(&conn).unwrap().len(), 2517, "el catálogo oficial sigue completo");
        assert_eq!(concept(&list_codes(&conn).unwrap(), "110505").as_deref(), Some("CAJA GENERAL"));
    }

    #[test]
    fn usage_covers_configurations_and_history() {
        let mut conn = db();
        for code in ["11050510", "11050511", "11050512", "11050513", "11050514"] {
            custom(&conn, code, "Referenciada");
        }
        crate::database::fs::save_puc_settings(&mut conn, &[crate::models::fs::PucSetting { key: "payroll.salary".into(), puc_code: "11050510".into() }]).unwrap();
        conn.execute("INSERT INTO fs_bank_concept_mappings (bank, concept, puc_code, created_at, updated_at) VALUES ('BBVA', 'CUOTA', '11050511', 'x', 'x')", []).unwrap();
        conn.execute("INSERT INTO companies (razon_social, nit, created_at, updated_at) VALUES ('E', '1', 'x', 'x')", []).unwrap();
        conn.execute("INSERT INTO fs_opening_drafts (company_id, balance_date, rows, updated_at) VALUES (1, '2025-12-31', '[{\"pucCode\":\"11050512\",\"amountCents\":5}]', 'x')", []).unwrap();
        movement(&conn, "11050513");
        let id: i64 = conn.query_row("SELECT id FROM fs_movements", [], |r| r.get(0)).unwrap();
        crate::database::fs::reclassify_movements(&mut conn, None, &[id], "11050514").unwrap();
        let kinds = |code: &str| code_usage(&conn, code).unwrap().items.into_iter().map(|i| i.kind).collect::<Vec<_>>();
        assert_eq!(kinds("11050510"), ["puc_settings"]);
        assert_eq!(kinds("11050511"), ["bank_concepts"]);
        assert_eq!(kinds("11050512"), ["opening_drafts"]);
        assert_eq!(kinds("11050513"), ["reclassified"], "el código anterior queda en el historial del movimiento");
        assert_eq!(kinds("11050514"), ["movements:purchases"]);
        for code in ["11050510", "11050511", "11050512", "11050513", "11050514"] {
            assert!(delete_custom_code(&mut conn, code).is_err(), "{code}");
        }
        assert_eq!(list_usage(&conn).unwrap().iter().filter(|u| u.code.starts_with("1105051")).count(), 5);
    }

    #[test]
    fn migration_011_keeps_existing_data() {
        use crate::database::migrations::{ensure_migrations_table, MIGRATIONS};
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_migrations_table(&conn).unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 10) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO schema_migrations VALUES (?1, ?2, 'x')", params![m.version, m.name]).unwrap();
        }
        conn.execute("INSERT INTO suppliers (nit, business_name, vat_type, created_at, updated_at) VALUES ('900319753', 'PRICESMART', 'purchase', 'c', 'u')", []).unwrap();
        let titles = list_titles(&conn).unwrap().len();
        assert_eq!(run_pending(&mut conn).unwrap()[0], "011_supplier_puc_codes");
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM suppliers", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!((list_codes(&conn).unwrap().len(), list_titles(&conn).unwrap().len()), (2517, titles));
        assert!(list_all_supplier_codes(&conn).unwrap().is_empty());
    }
}
