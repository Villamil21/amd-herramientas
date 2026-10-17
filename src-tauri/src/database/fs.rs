//! Estados Financieros: catálogo de cuentas, motor de movimientos contables por
//! empresa (lotes, duplicados, reemplazos, periodos cerrados), extractos
//! bancarios, nómina, ajustes y periodos con versiones.
//!
//! Reglas que se cumplen aquí, aunque la interfaz también las valide:
//! - Nada se borra físicamente: un reenvío deja el lote anterior «Reemplazado».
//! - Nunca se suma un duplicado en silencio: un envío repetido se detiene y el
//!   usuario decide (Reemplazar o Cancelar).
//! - Un movimiento con fecha dentro de un periodo cerrado se bloquea.
//! - Un periodo «Cuadrado» o con PDF que recibe movimientos dentro de su rango
//!   pasa a «Requiere nueva revisión».

use std::collections::{BTreeSet, HashMap};

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row, Transaction};
use serde_json::Value;

use crate::database::puc;
use crate::error::{AppError, AppResult};
use crate::models::fs::*;
use crate::services::time::now_iso;

pub const REVIEW_NEW_MOVEMENTS: &str = "Este periodo había sido conciliado, pero recibió nuevos movimientos después de su última validación.";
pub const CLOSED_PERIOD: &str = "Este movimiento afecta un periodo cerrado.\nDesbloquea el periodo desde Generador de Estados Financieros.";

fn json(text: String) -> Value {
    serde_json::from_str(&text).unwrap_or(Value::Null)
}

fn json_text(value: &Option<Value>) -> String {
    value.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "{}".into())
}

fn company_exists(conn: &Connection, id: i64) -> AppResult<()> {
    let ok: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)", [id], |r| r.get(0))?;
    if ok {
        Ok(())
    } else {
        Err(AppError::user("La empresa no existe o fue eliminada."))
    }
}

// ---------------------------------------------------------------------------
// Catálogo de cuentas de Estados Financieros
// ---------------------------------------------------------------------------

pub fn catalog(conn: &Connection) -> AppResult<FsCatalog> {
    let lines = conn
        .prepare(
            "SELECT l.id, l.section, l.name, l.sort_order, l.role, l.is_active,
                    EXISTS(SELECT 1 FROM fs_puc_mappings m WHERE m.line_id = l.id)
             FROM fs_lines l ORDER BY l.section, l.sort_order, l.id",
        )?
        .query_map([], |r| {
            Ok(FsLine { id: r.get(0)?, section: r.get(1)?, name: r.get(2)?, sort_order: r.get(3)?, role: r.get(4)?, is_active: r.get(5)?, has_history: r.get(6)? })
        })?
        .collect::<Result<_, _>>()?;
    let sections = conn
        .prepare("SELECT section, representative_line_id FROM fs_sections ORDER BY section")?
        .query_map([], |r| Ok(FsSection { section: r.get(0)?, representative_line_id: r.get(1)? }))?
        .collect::<Result<_, _>>()?;
    Ok(FsCatalog { lines, sections })
}

fn line_section(conn: &Connection, id: i64) -> AppResult<(String, Option<String>, bool)> {
    conn.query_row("SELECT section, role, is_active FROM fs_lines WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?
        .ok_or_else(|| AppError::user("La línea no existe."))
}

pub fn create_line(conn: &Connection, section: &str, name: &str) -> AppResult<i64> {
    validate_section(section)?;
    if !CREATABLE_SECTIONS.contains(&section) {
        return Err(AppError::user("En el Estado de Resultados, por ahora, solo se crean líneas en Gastos operacionales de administración o de ventas."));
    }
    let name = validate_line_name(name)?;
    let order: i64 = conn.query_row("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM fs_lines WHERE section = ?1", [section], |r| r.get(0))?;
    let now = now_iso();
    conn.execute(
        "INSERT INTO fs_lines (section, name, sort_order, role, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, NULL, 1, ?4, ?4)",
        params![section, name, order, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Renombra y activa / desactiva. Las líneas con cálculo automático y la cuenta
/// representativa de su sección no se desactivan.
pub fn update_line(conn: &Connection, id: i64, name: &str, is_active: bool) -> AppResult<()> {
    let name = validate_line_name(name)?;
    let (section, role, _) = line_section(conn, id)?;
    if !is_active {
        if role.is_some() {
            return Err(AppError::user("Esta línea hace parte de la estructura del estado (cálculo automático) y no se puede desactivar."));
        }
        let representative: Option<i64> = conn.query_row("SELECT representative_line_id FROM fs_sections WHERE section = ?1", [&section], |r| r.get(0)).optional()?.flatten();
        if representative == Some(id) {
            return Err(AppError::user("Es la cuenta representativa de su sección: elige otra antes de desactivarla."));
        }
    }
    conn.execute("UPDATE fs_lines SET name = ?1, is_active = ?2, updated_at = ?3 WHERE id = ?4", params![name, is_active, now_iso(), id])?;
    Ok(())
}

/// Orden manual de una sección (el del PDF). `ids` debe traer todas sus líneas.
pub fn reorder_lines(conn: &mut Connection, section: &str, ids: &[i64]) -> AppResult<()> {
    validate_section(section)?;
    let current: BTreeSet<i64> = conn.prepare("SELECT id FROM fs_lines WHERE section = ?1")?.query_map([section], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let given: BTreeSet<i64> = ids.iter().copied().collect();
    if current != given || given.len() != ids.len() {
        return Err(AppError::user("El orden no coincide con las líneas de la sección. Recarga la pantalla."));
    }
    let tx = conn.transaction()?;
    let now = now_iso();
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE fs_lines SET sort_order = ?1, updated_at = ?2 WHERE id = ?3", params![i as i64 + 1, now, id])?;
    }
    tx.commit()?;
    Ok(())
}

pub fn set_representative(conn: &Connection, section: &str, line_id: i64) -> AppResult<()> {
    validate_section(section)?;
    let (line_sec, _, active) = line_section(conn, line_id)?;
    if line_sec != section || !active {
        return Err(AppError::user("La cuenta representativa debe ser una línea activa de la misma sección."));
    }
    conn.execute(
        "INSERT INTO fs_sections (section, representative_line_id) VALUES (?1, ?2) ON CONFLICT(section) DO UPDATE SET representative_line_id = excluded.representative_line_id",
        params![section, line_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// PUC → línea de Estados Financieros
// ---------------------------------------------------------------------------

pub fn list_mappings(conn: &Connection) -> AppResult<Vec<FsPucMapping>> {
    Ok(conn
        .prepare("SELECT puc_code, line_id, excluded, updated_at FROM fs_puc_mappings ORDER BY puc_code")?
        .query_map([], |r| Ok(FsPucMapping { puc_code: r.get(0)?, line_id: r.get(1)?, excluded: r.get(2)?, updated_at: r.get(3)? }))?
        .collect::<Result<_, _>>()?)
}

/// Asigna un PUC a una línea o lo marca «No afecta Estados Financieros». Cada
/// cambio queda en el historial. Los periodos abiertos se recalculan solos (el
/// generador lee el mapeo vigente); los cerrados conservan su snapshot.
pub fn set_mapping(conn: &mut Connection, code: &str, line_id: Option<i64>, excluded: bool) -> AppResult<()> {
    let known: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM puc_codes WHERE code = ?1) OR EXISTS(SELECT 1 FROM puc_custom_codes WHERE code = ?1)", [code], |r| r.get(0))?;
    if !known {
        return Err(AppError::user(format!("El código {code} no existe en la Tabla de Códigos PUC.")));
    }
    let line_id = if excluded { None } else { Some(line_id.ok_or_else(|| AppError::user("Elige la línea del estado financiero."))?) };
    if let Some(id) = line_id {
        let (_, _, active) = line_section(conn, id)?;
        if !active {
            return Err(AppError::user("La línea está desactivada."));
        }
    }
    let tx = conn.transaction()?;
    let old: Option<(Option<i64>, bool)> = tx.query_row("SELECT line_id, excluded FROM fs_puc_mappings WHERE puc_code = ?1", [code], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    if old == Some((line_id, excluded)) {
        return Ok(());
    }
    let now = now_iso();
    tx.execute(
        "INSERT INTO fs_puc_mappings (puc_code, line_id, excluded, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(puc_code) DO UPDATE SET line_id = excluded.line_id, excluded = excluded.excluded, updated_at = excluded.updated_at",
        params![code, line_id, excluded, now],
    )?;
    tx.execute(
        "INSERT INTO fs_puc_mapping_history (puc_code, old_line_id, old_excluded, new_line_id, new_excluded, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![code, old.and_then(|o| o.0), old.map(|o| o.1), line_id, excluded, now],
    )?;
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Periodos cerrados e invalidación
// ---------------------------------------------------------------------------

/// Rango de un periodo cerrado de la empresa que contiene alguna de las fechas.
fn closed_period_for(conn: &Connection, company_id: i64, dates: &BTreeSet<String>) -> AppResult<Option<(String, String)>> {
    let closed: Vec<(String, String)> = conn
        .prepare("SELECT start_date, end_date FROM fs_periods WHERE company_id = ?1 AND status = 'closed'")?
        .query_map([company_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(closed.into_iter().find(|(s, e)| dates.iter().any(|d| d >= s && d <= e)))
}

pub fn ensure_open(conn: &Connection, company_id: i64, dates: &BTreeSet<String>) -> AppResult<()> {
    if let Some((s, e)) = closed_period_for(conn, company_id, dates)? {
        return Err(AppError::user(format!("{CLOSED_PERIOD}\n(Periodo cerrado: {s} a {e}.)")));
    }
    Ok(())
}

/// Periodos «Cuadrado» o «PDF generado» con alguna fecha dentro de su rango → «Requiere nueva revisión».
fn invalidate_periods(tx: &Connection, company_id: i64, dates: &BTreeSet<String>, reason: &str) -> AppResult<i64> {
    let periods: Vec<(i64, String, String)> = tx
        .prepare("SELECT id, start_date, end_date FROM fs_periods WHERE company_id = ?1 AND status IN ('ready', 'pdf_generated')")?
        .query_map([company_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let now = now_iso();
    let mut n = 0;
    for (id, s, e) in periods {
        if dates.iter().any(|d| *d >= s && *d <= e) {
            tx.execute("UPDATE fs_periods SET status = 'needs_review', review_reason = ?1, updated_at = ?2 WHERE id = ?3", params![reason, now, id])?;
            tx.execute("INSERT INTO fs_period_events (period_id, action, note, created_at) VALUES (?1, 'needs_review', ?2, ?3)", params![id, reason, now])?;
            n += 1;
        }
    }
    Ok(n)
}

// ---------------------------------------------------------------------------
// Lotes y movimientos
// ---------------------------------------------------------------------------

const BATCH_COLUMNS: &str = "id, company_id, source, file_name, period_label, period_start, period_end, dedupe_key, record_count, total_cents, status, replaced_by, metadata, created_at";

fn map_batch(r: &Row) -> rusqlite::Result<BatchSummary> {
    Ok(BatchSummary {
        id: r.get(0)?,
        company_id: r.get(1)?,
        source: r.get(2)?,
        file_name: r.get(3)?,
        period_label: r.get(4)?,
        period_start: r.get(5)?,
        period_end: r.get(6)?,
        dedupe_key: r.get(7)?,
        record_count: r.get(8)?,
        total_cents: r.get(9)?,
        status: r.get(10)?,
        replaced_by: r.get(11)?,
        metadata: json(r.get(12)?),
        created_at: r.get(13)?,
    })
}

pub fn list_batches(conn: &Connection, company_id: i64) -> AppResult<Vec<BatchSummary>> {
    Ok(conn.prepare(&format!("SELECT {BATCH_COLUMNS} FROM fs_batches WHERE company_id = ?1 ORDER BY id DESC"))?.query_map([company_id], map_batch)?.collect::<Result<_, _>>()?)
}

const MOVEMENT_COLUMNS: &str = "id, company_id, batch_id, accounting_date, source, concept_key, document_id, document_number, document_type, supplier_id, supplier_nit, supplier_name, employee_id, employment_id, bank, account_number, puc_code, puc_concept, description, amount_cents, dc, settles_on, status, detail, created_at";

fn map_movement(r: &Row) -> rusqlite::Result<Movement> {
    Ok(Movement {
        id: r.get(0)?,
        company_id: r.get(1)?,
        batch_id: r.get(2)?,
        accounting_date: r.get(3)?,
        source: r.get(4)?,
        concept_key: r.get(5)?,
        document_id: r.get(6)?,
        document_number: r.get(7)?,
        document_type: r.get(8)?,
        supplier_id: r.get(9)?,
        supplier_nit: r.get(10)?,
        supplier_name: r.get(11)?,
        employee_id: r.get(12)?,
        employment_id: r.get(13)?,
        bank: r.get(14)?,
        account_number: r.get(15)?,
        puc_code: r.get(16)?,
        puc_concept: r.get(17)?,
        description: r.get(18)?,
        amount_cents: r.get(19)?,
        dc: r.get(20)?,
        settles_on: r.get(21)?,
        status: r.get(22)?,
        detail: json(r.get(23)?),
        created_at: r.get(24)?,
    })
}

/// Todos los movimientos de la empresa (cualquier estado), en orden de fecha.
pub fn list_movements(conn: &Connection, company_id: i64) -> AppResult<Vec<Movement>> {
    Ok(conn
        .prepare(&format!("SELECT {MOVEMENT_COLUMNS} FROM fs_movements WHERE company_id = ?1 ORDER BY accounting_date, id"))?
        .query_map([company_id], map_movement)?
        .collect::<Result<_, _>>()?)
}

fn validate_batch(conn: &Connection, input: &BatchInput) -> AppResult<()> {
    company_exists(conn, input.company_id)?;
    if !SOURCES.contains(&input.source.as_str()) {
        return Err(AppError::user("El origen del envío no es válido."));
    }
    if input.movements.is_empty() && input.bank_balances.is_empty() {
        return Err(AppError::user("No hay movimientos para enviar a Estados Financieros."));
    }
    for d in [&input.period_start, &input.period_end].into_iter().flatten() {
        validate_iso_date(d, "Periodo")?;
    }
    for m in &input.movements {
        validate_iso_date(&m.accounting_date, "Fecha contable")?;
        if let Some(s) = &m.settles_on {
            validate_iso_date(s, "Fecha de pago")?;
        }
        if m.dc.as_deref().is_some_and(|d| d != "D" && d != "C") {
            return Err(AppError::user("Naturaleza del movimiento no válida."));
        }
    }
    for b in &input.bank_balances {
        validate_iso_date(&b.balance_date, "Fecha del saldo")?;
        if b.bank.trim().is_empty() || b.account_number.trim().is_empty() {
            return Err(AppError::user("El saldo bancario necesita banco y número de cuenta."));
        }
    }
    for p in &input.payroll_rows {
        validate_period(&p.period)?;
        validate_iso_date(&p.payment_date, "Fecha de pago")?;
        let ok: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM fs_employments j JOIN fs_employees e ON e.id = j.employee_id WHERE j.id = ?1 AND e.id = ?2 AND e.company_id = ?3)",
            params![p.employment_id, p.employee_id, input.company_id],
            |r| r.get(0),
        )?;
        if !ok {
            return Err(AppError::user("Un empleado de la planilla no pertenece a esta empresa. Recarga la pantalla."));
        }
    }
    Ok(())
}

/// Una misma persona no se contabiliza dos veces en un periodo: si un empleado ya fue enviado para ese periodo
/// desde OTRO operador de planilla (Aportes en Línea, MiPlanilla…), el envío se rechaza (ni siquiera con «Reemplazar»).
/// Operadores distintos pueden completar un mismo periodo con empleados distintos. Dentro del mismo operador
/// rige el flujo normal de duplicados y reemplazo.
fn ensure_no_employee_overlap_between_operators(conn: &Connection, input: &BatchInput) -> AppResult<()> {
    if input.source != "payroll" || input.payroll_rows.is_empty() {
        return Ok(());
    }
    let provider = input.metadata.as_ref().and_then(|m| m.get("provider")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut stmt = conn.prepare(
        "SELECT b.id, b.file_name, COALESCE(json_extract(b.metadata, '$.provider'), ''), e.name
         FROM fs_payroll_rows p
         JOIN fs_batches b ON b.id = p.batch_id
         JOIN fs_employees e ON e.id = p.employee_id
         WHERE p.company_id = ?1 AND p.employee_id = ?2 AND p.period = ?3 AND b.status = 'active'
           AND COALESCE(json_extract(b.metadata, '$.provider'), '') <> ?4
         ORDER BY b.id LIMIT 1",
    )?;
    for row in &input.payroll_rows {
        let found = stmt
            .query_row(params![input.company_id, row.employee_id, row.period, provider], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))
            .optional()?;
        if let Some((batch_id, file_name, other, name)) = found {
            let operator = if other.is_empty() { "otro operador".to_string() } else { other };
            return Err(AppError::user(format!(
                "{name} ya fue enviado para {} desde {operator} (lote #{batch_id}, «{file_name}»). Una persona no se contabiliza dos veces en el mismo periodo: quítala de esta planilla o anula ese lote primero.",
                row.period
            )));
        }
    }
    Ok(())
}

/// Envía un lote a Estados Financieros (todo o nada). Si el envío o alguno de
/// sus documentos ya existe y el usuario no eligió «Reemplazar», no guarda
/// nada y devuelve lo que ya existe.
pub fn send_batch(conn: &mut Connection, input: &BatchInput) -> AppResult<SendOutcome> {
    validate_batch(conn, input)?;
    let concepts: HashMap<String, String> = {
        let mut map = HashMap::new();
        for code in input.movements.iter().map(|m| m.puc_code.trim()).chain(input.bank_balances.iter().map(|b| b.puc_code.trim())) {
            if map.contains_key(code) {
                continue;
            }
            let concept = puc::assignable_concept(conn, code)?.ok_or_else(|| AppError::user(format!("El código PUC «{code}» no existe o no se puede asignar (usa una subcuenta de 6 dígitos o un código personalizado).")))?;
            map.insert(code.to_string(), concept);
        }
        map
    };

    let tx = conn.transaction()?;
    ensure_no_employee_overlap_between_operators(&tx, input)?;
    // 1. Lo que ya existe: el mismo envío (dedupe_key) o documentos ya enviados.
    let mut previous: BTreeSet<i64> = BTreeSet::new();
    if !input.dedupe_key.is_empty() {
        let ids: Vec<i64> = tx
            .prepare("SELECT id FROM fs_batches WHERE company_id = ?1 AND source = ?2 AND dedupe_key = ?3 AND status = 'active'")?
            .query_map(params![input.company_id, input.source, input.dedupe_key], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        previous.extend(ids);
    }
    let documents: BTreeSet<&str> = input.movements.iter().map(|m| m.document_id.as_str()).filter(|d| !d.is_empty()).collect();
    let mut repeated: Vec<i64> = Vec::new(); // id de movimientos activos con el mismo documento
    {
        let mut stmt = tx.prepare("SELECT id, batch_id FROM fs_movements WHERE company_id = ?1 AND source = ?2 AND document_id = ?3 AND status = 'active'")?;
        for doc in &documents {
            for row in stmt.query_map(params![input.company_id, input.source, doc], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
                let (id, batch) = row?;
                repeated.push(id);
                previous.insert(batch);
            }
        }
    }
    // Un periodo registrado «sin actividad» en alguno de los meses: se pide reemplazar el registro vacío.
    let mut sent_months: BTreeSet<String> = input.movements.iter().map(|m| m.accounting_date[..7].to_string()).collect();
    sent_months.extend(input.payroll_rows.iter().map(|p| p.period.clone()));
    previous.extend(active_empty_periods(&tx, input.company_id, &input.source, &sent_months)?.into_iter().map(|(id, _)| id));
    if !previous.is_empty() && !input.replace {
        let placeholders = previous.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let batches = tx
            .prepare(&format!("SELECT {BATCH_COLUMNS} FROM fs_batches WHERE id IN ({placeholders}) ORDER BY id"))?
            .query_map(params_from_iter(previous.iter()), map_batch)?
            .collect::<Result<_, _>>()?;
        let repeated_documents = tx
            .prepare("SELECT COUNT(DISTINCT document_id) FROM fs_movements WHERE company_id = ?1 AND source = ?2 AND status = 'active' AND document_id <> '' AND document_id IN (SELECT value FROM json_each(?3))")?
            .query_row(params![input.company_id, input.source, serde_json::to_string(&documents)?], |r| r.get(0))?;
        return Ok(SendOutcome::Duplicate { batches, repeated_documents });
    }

    // 2. Periodos cerrados: ni lo nuevo ni lo que se reemplazaría.
    let mut dates: BTreeSet<String> = input.movements.iter().map(|m| m.accounting_date.clone()).collect();
    dates.extend(input.bank_balances.iter().map(|b| b.balance_date.clone()));
    let mut touched = dates.clone();
    if !previous.is_empty() {
        let placeholders = previous.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let old: Vec<String> = tx
            .prepare(&format!("SELECT accounting_date FROM fs_movements WHERE status = 'active' AND (batch_id IN ({placeholders})) UNION SELECT balance_date FROM fs_bank_balances WHERE batch_id IN ({placeholders})"))?
            .query_map(params_from_iter(previous.iter().chain(previous.iter())), |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        touched.extend(old);
    }
    ensure_open(&tx, input.company_id, &touched)?;

    // 3. Lote nuevo.
    let now = now_iso();
    let total: i64 = input.movements.iter().map(|m| m.amount_cents).sum();
    let records = if input.payroll_rows.is_empty() { input.movements.len() } else { input.payroll_rows.len() } as i64;
    tx.execute(
        "INSERT INTO fs_batches (company_id, source, file_name, period_label, period_start, period_end, dedupe_key, record_count, total_cents, status, metadata, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active', ?10, ?11, ?11)",
        params![input.company_id, input.source, input.file_name, input.period_label, input.period_start, input.period_end, input.dedupe_key, records, total, json_text(&input.metadata), now],
    )?;
    let batch_id = tx.last_insert_rowid();

    // 4. Reemplazo: el envío anterior completo y los documentos repetidos de otros envíos.
    let mut replaced_batch_ids = Vec::new();
    if input.replace && !previous.is_empty() {
        for id in &repeated {
            tx.execute("UPDATE fs_movements SET status = 'replaced', updated_at = ?1 WHERE id = ?2", params![now, id])?;
        }
        for b in &previous {
            let same_send: bool = tx.query_row("SELECT dedupe_key <> '' AND dedupe_key = ?2 FROM fs_batches WHERE id = ?1", params![b, input.dedupe_key], |r| r.get(0))?;
            if same_send {
                tx.execute("UPDATE fs_movements SET status = 'replaced', updated_at = ?1 WHERE batch_id = ?2 AND status = 'active'", params![now, b])?;
            }
            let left: i64 = tx.query_row("SELECT COUNT(*) FROM fs_movements WHERE batch_id = ?1 AND status = 'active'", [b], |r| r.get(0))?;
            if same_send || left == 0 {
                tx.execute("UPDATE fs_batches SET status = 'replaced', replaced_by = ?1, updated_at = ?2 WHERE id = ?3", params![batch_id, now, b])?;
                replaced_batch_ids.push(*b);
            }
        }
    }

    {
        let mut stmt = tx.prepare(
            "INSERT INTO fs_movements (company_id, batch_id, accounting_date, source, concept_key, document_id, document_number, document_type, supplier_id, supplier_nit, supplier_name,
                employee_id, employment_id, bank, account_number, puc_code, puc_concept, description, amount_cents, dc, settles_on, status, detail, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, 'active', ?22, ?23, ?23)",
        )?;
        for m in &input.movements {
            let code = m.puc_code.trim();
            stmt.execute(params![
                input.company_id,
                batch_id,
                m.accounting_date,
                input.source,
                m.concept_key,
                m.document_id,
                m.document_number,
                m.document_type,
                m.supplier_id,
                m.supplier_nit,
                m.supplier_name,
                m.employee_id,
                m.employment_id,
                m.bank,
                m.account_number,
                code,
                concepts[code],
                m.description,
                m.amount_cents,
                m.dc,
                m.settles_on,
                json_text(&m.detail),
                now
            ])?;
        }
    }
    for b in &input.bank_balances {
        tx.execute(
            "INSERT INTO fs_bank_balances (company_id, batch_id, bank, account_number, balance_date, balance_cents, puc_code, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![input.company_id, batch_id, b.bank, b.account_number, b.balance_date, b.balance_cents, b.puc_code.trim(), now],
        )?;
        tx.execute(
            "INSERT INTO fs_bank_accounts (company_id, bank, account_number, puc_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(company_id, bank, account_number) DO UPDATE SET puc_code = excluded.puc_code, updated_at = excluded.updated_at",
            params![input.company_id, b.bank, b.account_number, b.puc_code.trim(), now],
        )?;
    }
    for c in &input.bank_concept_mappings {
        if puc::assignable_concept(&tx, c.puc_code.trim())?.is_none() {
            return Err(AppError::user(format!("El código PUC «{}» no se puede asignar.", c.puc_code)));
        }
        tx.execute(
            "INSERT INTO fs_bank_concept_mappings (bank, concept, puc_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(bank, concept) DO UPDATE SET puc_code = excluded.puc_code, updated_at = excluded.updated_at",
            params![c.bank, c.concept, c.puc_code.trim(), now],
        )?;
    }
    for p in &input.payroll_rows {
        tx.execute(
            "INSERT INTO fs_payroll_rows (company_id, batch_id, employee_id, employment_id, period, payment_date, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![input.company_id, batch_id, p.employee_id, p.employment_id, p.period, p.payment_date, json_text(&p.detail), now],
        )?;
    }
    for d in &input.decisions {
        tx.execute(
            "INSERT INTO fs_decisions (company_id, batch_id, source, document_key, decision, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![input.company_id, batch_id, input.source, d.document_key, d.decision, d.detail, now],
        )?;
    }
    let invalidated_periods = invalidate_periods(&tx, input.company_id, &touched, REVIEW_NEW_MOVEMENTS)?;
    tx.commit()?;
    Ok(SendOutcome::Sent { batch_id, replaced_batch_ids, invalidated_periods })
}

/// Retira del cálculo vigente el lote de Transacciones Cripto cuyo efecto ya no se puede recalcular con las fuentes actuales.
/// El lote y sus movimientos se conservan para auditoría (quedan «voided» y marcados `stale`); los periodos «Cuadrado» o
/// «PDF generado» que tocaba vuelven a «Requiere nueva revisión». Un periodo cerrado no se modifica: hay que desbloquearlo.
pub fn void_crypto_batch(conn: &mut Connection, batch_id: i64, reason: &str) -> AppResult<i64> {
    let row: Option<(i64, String, String)> = conn.query_row("SELECT company_id, source, status FROM fs_batches WHERE id = ?1", [batch_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
    let Some((company_id, source, status)) = row else {
        return Err(AppError::user("El envío ya no existe. Recarga la pantalla."));
    };
    if source != "crypto_ops" || status != "active" {
        return Err(AppError::user("Solo se puede retirar un envío activo de Transacciones Cripto."));
    }
    let dates: BTreeSet<String> = conn
        .prepare("SELECT DISTINCT accounting_date FROM fs_movements WHERE batch_id = ?1 AND status = 'active'")?
        .query_map([batch_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    ensure_open(conn, company_id, &dates)?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute("UPDATE fs_movements SET status = 'voided', updated_at = ?1 WHERE batch_id = ?2 AND status = 'active'", params![now, batch_id])?;
    tx.execute(
        "UPDATE fs_batches SET status = 'voided', metadata = json_set(COALESCE(metadata, '{}'), '$.stale', 1, '$.staleReason', ?3), updated_at = ?1 WHERE id = ?2",
        params![now, batch_id, reason.trim()],
    )?;
    tx.execute(
        "INSERT INTO fs_decisions (company_id, batch_id, source, document_key, decision, detail, created_at) VALUES (?1, ?2, 'crypto_ops', '', 'crypto_stale_voided', ?3, ?4)",
        params![company_id, batch_id, reason.trim(), now],
    )?;
    let invalidated = invalidate_periods(&tx, company_id, &dates, "El efecto de Transacciones Cripto quedó desactualizado y se retiró del cálculo: resuelve sus pendientes y vuelve a revisar el periodo.")?;
    tx.commit()?;
    Ok(invalidated)
}

/// Marca como desactualizado un lote de Transacciones Cripto que no se pudo reemplazar (p. ej. por un periodo cerrado). A
/// diferencia de `void_crypto_batch` no cambia movimientos ni periodos —por eso funciona aunque el periodo esté cerrado—: el lote
/// queda solo para auditoría (el cálculo vigente lo ignora y generar, marcar listo, cerrar y exportar se bloquean) hasta que
/// pueda reemplazarse con las fuentes actuales.
pub fn mark_crypto_batch_outdated(conn: &mut Connection, batch_id: i64, reason: &str) -> AppResult<()> {
    let row: Option<(i64, String, String)> = conn.query_row("SELECT company_id, source, status FROM fs_batches WHERE id = ?1", [batch_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
    let Some((company_id, source, status)) = row else {
        return Err(AppError::user("El envío ya no existe. Recarga la pantalla."));
    };
    if source != "crypto_ops" || status != "active" {
        return Err(AppError::user("Solo se puede marcar un envío activo de Transacciones Cripto."));
    }
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "UPDATE fs_batches SET metadata = json_set(COALESCE(metadata, '{}'), '$.outdated', 1, '$.outdatedReason', ?3), updated_at = ?1 WHERE id = ?2",
        params![now, batch_id, reason.trim()],
    )?;
    tx.execute(
        "INSERT INTO fs_decisions (company_id, batch_id, source, document_key, decision, detail, created_at) VALUES (?1, ?2, 'crypto_ops', '', 'crypto_outdated', ?3, ?4)",
        params![company_id, batch_id, reason.trim(), now],
    )?;
    tx.commit()?;
    Ok(())
}

/// Prefijo de la clave de envío del módulo «Compras, costos y exógena» (`purchases:AAAA`).
pub const PURCHASES_BATCH_PREFIX: &str = "purchases:";

/// Retira del cálculo vigente los envíos de la antigua «Clasificación contable de compras».
///
/// Causa raíz de su inclusión: el módulo nuevo envía a la misma fuente (`purchases`) que el antiguo y Estados Financieros suma
/// todo lote activo de una fuente, así que los envíos viejos (clave vacía o por documento) seguían activos junto al lote anual
/// nuevo y las mismas facturas se contaban dos veces. El módulo nuevo empieza de cero: lo anterior queda «Anulado» y marcado
/// `legacy` (movimientos y lote se conservan solo para auditoría). Los registros «periodo sin actividad» no son datos de ese
/// módulo y se respetan. Un periodo cerrado conserva sus valores aprobados; los «Cuadrado» o «PDF generado» que tocaba vuelven
/// a revisión. Es idempotente: se ejecuta al iniciar y tras restaurar un backup (que podría traer lotes viejos activos).
pub fn retire_legacy_purchases(conn: &Connection) -> AppResult<i64> {
    let legacy: Vec<(i64, i64)> = conn
        .prepare(
            "SELECT id, company_id FROM fs_batches
             WHERE source = 'purchases' AND status = 'active' AND dedupe_key NOT LIKE 'purchases:%'
               AND COALESCE(json_extract(metadata, '$.emptyPeriod'), 0) <> 1",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let now = now_iso();
    let reason = "Envío de la antigua «Clasificación contable de compras»: el módulo Compras, costos y exógena empieza desde cero y no lo usa en ningún cálculo.";
    let mut touched: HashMap<i64, BTreeSet<String>> = HashMap::new();
    for (id, company_id) in &legacy {
        let dates: Vec<String> = conn
            .prepare("SELECT DISTINCT accounting_date FROM fs_movements WHERE batch_id = ?1 AND status = 'active'")?
            .query_map([id], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        touched.entry(*company_id).or_default().extend(dates);
        conn.execute("UPDATE fs_movements SET status = 'voided', updated_at = ?1 WHERE batch_id = ?2 AND status = 'active'", params![now, id])?;
        conn.execute(
            "UPDATE fs_batches SET status = 'voided', metadata = json_set(COALESCE(metadata, '{}'), '$.legacy', 1, '$.legacyReason', ?3), updated_at = ?1 WHERE id = ?2",
            params![now, id, reason],
        )?;
        conn.execute(
            "INSERT INTO fs_decisions (company_id, batch_id, source, document_key, decision, detail, created_at) VALUES (?1, ?2, 'purchases', '', 'legacy_purchases_retired', ?3, ?4)",
            params![company_id, id, reason, now],
        )?;
    }
    for (company_id, dates) in touched {
        invalidate_periods(conn, company_id, &dates, "Se retiraron del cálculo los envíos de la antigua Clasificación contable de compras: revisa el periodo.")?;
    }
    Ok(legacy.len() as i64)
}

// ---------------------------------------------------------------------------
// Periodos sin actividad («Sin compras», «Sin nómina», «Sin ventas»…)
// ---------------------------------------------------------------------------

const EMPTY_PERIOD_FILE: &str = "Registro de periodo sin actividad";

/// Lotes activos «periodo sin actividad» de la fuente en esos meses: (id, mes).
fn active_empty_periods(conn: &Connection, company_id: i64, source: &str, months: &BTreeSet<String>) -> AppResult<Vec<(i64, String)>> {
    if months.is_empty() {
        return Ok(vec![]);
    }
    let rows: Vec<(i64, String)> = conn
        .prepare("SELECT id, substr(period_start, 1, 7) FROM fs_batches WHERE company_id = ?1 AND source = ?2 AND status = 'active' AND json_extract(metadata, '$.emptyPeriod') = 1")?
        .query_map(params![company_id, source], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(rows.into_iter().filter(|(_, m)| months.contains(m)).collect())
}

/// Último día del mes AAAA-MM (AAAA-MM-DD).
fn month_end(month: &str) -> String {
    let (y, m): (i32, u32) = (month[..4].parse().unwrap_or(2000), month[5..].parse().unwrap_or(1));
    let days = match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    format!("{month}-{days:02}")
}

/// Registra meses sin actividad de una fuente: un lote vacío por mes, sin
/// movimientos, que cubre el mes en el Generador. Respeta periodos cerrados; si
/// algún mes ya tiene información real activa se detiene (HasData) hasta que
/// el usuario acepte la advertencia. Un mes ya registrado sin actividad no se repite.
pub fn register_empty_period(conn: &mut Connection, input: &EmptyPeriodInput) -> AppResult<EmptyPeriodOutcome> {
    company_exists(conn, input.company_id)?;
    if !EMPTY_PERIOD_SOURCES.contains(&input.source.as_str()) {
        return Err(AppError::user("Este origen no admite registrar un periodo sin actividad."));
    }
    if input.confirmation.trim().is_empty() {
        return Err(AppError::user("Confirma explícitamente que no hubo actividad en el periodo."));
    }
    let months: BTreeSet<String> = input.months.iter().map(|m| m.trim().to_string()).collect();
    if months.is_empty() {
        return Err(AppError::user("Elige al menos un mes."));
    }
    for m in &months {
        validate_period(m)?;
    }
    let dates: BTreeSet<String> = months.iter().flat_map(|m| [format!("{m}-01"), month_end(m)]).collect();
    ensure_open(conn, input.company_id, &dates)?;

    let with_data: Vec<String> = {
        let mut stmt = conn.prepare("SELECT EXISTS(SELECT 1 FROM fs_movements WHERE company_id = ?1 AND source = ?2 AND status = 'active' AND substr(accounting_date, 1, 7) = ?3)")?;
        let mut out = Vec::new();
        for m in &months {
            if stmt.query_row(params![input.company_id, input.source, m], |r| r.get::<_, bool>(0))? {
                out.push(m.clone());
            }
        }
        out
    };
    if !with_data.is_empty() && !input.allow_with_data {
        return Ok(EmptyPeriodOutcome::HasData { months: with_data });
    }

    let already: BTreeSet<String> = active_empty_periods(conn, input.company_id, &input.source, &months)?.into_iter().map(|(_, m)| m).collect();
    let tx = conn.transaction()?;
    let now = now_iso();
    let mut batch_ids = Vec::new();
    for m in months.iter().filter(|m| !already.contains(*m)) {
        let metadata = serde_json::json!({
            "emptyPeriod": true,
            "confirmation": input.confirmation.trim(),
            "confirmedAt": now,
            "withExistingData": with_data.contains(m),
        });
        tx.execute(
            "INSERT INTO fs_batches (company_id, source, file_name, period_label, period_start, period_end, dedupe_key, record_count, total_cents, status, metadata, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, 'active', ?8, ?9, ?9)",
            params![input.company_id, input.source, EMPTY_PERIOD_FILE, m, format!("{m}-01"), month_end(m), format!("empty:{m}"), metadata.to_string(), now],
        )?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO fs_decisions (company_id, batch_id, source, document_key, decision, detail, created_at) VALUES (?1, ?2, ?3, ?4, 'empty_period', ?5, ?6)",
            params![input.company_id, id, input.source, m, input.confirmation.trim(), now],
        )?;
        batch_ids.push(id);
    }
    tx.commit()?;
    Ok(EmptyPeriodOutcome::Registered { batch_ids })
}

/// Anula un registro «periodo sin actividad» (queda «Anulado», no se borra).
pub fn void_empty_period(conn: &mut Connection, batch_id: i64, reason: &str) -> AppResult<()> {
    let row: Option<(i64, String, String, String, String, bool)> = conn
        .query_row(
            "SELECT company_id, source, status, period_start, period_end, COALESCE(json_extract(metadata, '$.emptyPeriod'), 0) = 1 FROM fs_batches WHERE id = ?1",
            [batch_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, Option<String>>(3)?.unwrap_or_default(), r.get::<_, Option<String>>(4)?.unwrap_or_default(), r.get(5)?)),
        )
        .optional()?;
    let Some((company_id, source, status, start, end, empty)) = row else {
        return Err(AppError::user("El registro ya no existe. Recarga la pantalla."));
    };
    if !empty || status != "active" {
        return Err(AppError::user("Solo se puede anular un registro activo de periodo sin actividad."));
    }
    ensure_open(conn, company_id, &BTreeSet::from([start, end]))?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute("UPDATE fs_batches SET status = 'voided', updated_at = ?1 WHERE id = ?2", params![now, batch_id])?;
    tx.execute(
        "INSERT INTO fs_decisions (company_id, batch_id, source, document_key, decision, detail, created_at) VALUES (?1, ?2, ?3, '', 'empty_period_voided', ?4, ?5)",
        params![company_id, batch_id, source, reason.trim(), now],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn list_bank_balances(conn: &Connection, company_id: i64) -> AppResult<Vec<BankBalance>> {
    Ok(conn
        .prepare(
            "SELECT b.id, b.batch_id, b.bank, b.account_number, b.balance_date, b.balance_cents, b.puc_code, t.status = 'active'
             FROM fs_bank_balances b JOIN fs_batches t ON t.id = b.batch_id WHERE b.company_id = ?1 ORDER BY b.balance_date, b.id",
        )?
        .query_map([company_id], |r| {
            Ok(BankBalance { id: r.get(0)?, batch_id: r.get(1)?, bank: r.get(2)?, account_number: r.get(3)?, balance_date: r.get(4)?, balance_cents: r.get(5)?, puc_code: r.get(6)?, active: r.get(7)? })
        })?
        .collect::<Result<_, _>>()?)
}

pub fn list_bank_accounts(conn: &Connection) -> AppResult<Vec<BankAccount>> {
    Ok(conn
        .prepare("SELECT id, company_id, bank, account_number, puc_code FROM fs_bank_accounts ORDER BY company_id, bank, account_number")?
        .query_map([], |r| Ok(BankAccount { id: r.get(0)?, company_id: r.get(1)?, bank: r.get(2)?, account_number: r.get(3)?, puc_code: r.get(4)? }))?
        .collect::<Result<_, _>>()?)
}

pub fn list_bank_concept_mappings(conn: &Connection) -> AppResult<Vec<BankConceptMapping>> {
    Ok(conn
        .prepare("SELECT bank, concept, puc_code FROM fs_bank_concept_mappings ORDER BY bank, concept")?
        .query_map([], |r| Ok(BankConceptMapping { bank: r.get(0)?, concept: r.get(1)?, puc_code: r.get(2)? }))?
        .collect::<Result<_, _>>()?)
}

// ---------------------------------------------------------------------------
// Ciclo de vida de cuentas bancarias y GMF
// ---------------------------------------------------------------------------

fn validate_optional_period(period: &Option<String>) -> AppResult<Option<String>> {
    match period.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => {
            validate_period(p)?;
            Ok(Some(p.to_string()))
        }
        None => Ok(None),
    }
}

/// Apertura, cierre y respuestas del usuario de las cuentas de una empresa.
/// También aparecen las cuentas con solo respuestas «No» (sin apertura ni cierre).
pub fn list_bank_lifecycles(conn: &Connection, company_id: i64) -> AppResult<Vec<BankAccountLifecycle>> {
    let mut list: Vec<BankAccountLifecycle> = conn
        .prepare("SELECT company_id, bank, account_number, opened_period, closed_period, status, updated_at FROM fs_bank_account_lifecycle WHERE company_id = ?1 ORDER BY bank, account_number")?
        .query_map([company_id], |r| {
            Ok(BankAccountLifecycle { company_id: r.get(0)?, bank: r.get(1)?, account_number: r.get(2)?, opened_period: r.get(3)?, closed_period: r.get(4)?, status: r.get(5)?, updated_at: r.get(6)?, events: vec![] })
        })?
        .collect::<Result<_, _>>()?;
    let events: Vec<BankAccountEvent> = conn
        .prepare("SELECT bank, account_number, action, period, note, previous, created_at FROM fs_bank_account_events WHERE company_id = ?1 ORDER BY id")?
        .query_map([company_id], |r| Ok(BankAccountEvent { bank: r.get(0)?, account_number: r.get(1)?, action: r.get(2)?, period: r.get(3)?, note: r.get(4)?, previous: json(r.get(5)?), created_at: r.get(6)? }))?
        .collect::<Result<_, _>>()?;
    for e in events {
        let i = match list.iter().position(|l| l.bank == e.bank && l.account_number == e.account_number) {
            Some(i) => i,
            None => {
                list.push(BankAccountLifecycle { company_id, bank: e.bank.clone(), account_number: e.account_number.clone(), opened_period: None, closed_period: None, status: "active".into(), updated_at: e.created_at.clone(), events: vec![] });
                list.len() - 1
            }
        };
        list[i].events.push(e);
    }
    Ok(list)
}

/// Guarda la respuesta del usuario sobre una cuenta. Apertura y cierre son
/// editables; cada cambio (y cada «No») queda en la auditoría con lo anterior.
pub fn save_bank_lifecycle(conn: &mut Connection, input: &BankLifecycleInput) -> AppResult<()> {
    company_exists(conn, input.company_id)?;
    let (bank, account) = (input.bank.trim(), input.account_number.trim());
    if bank.is_empty() || account.is_empty() {
        return Err(AppError::user("La cuenta necesita banco y número de cuenta."));
    }
    let period = validate_optional_period(&input.period)?;
    let tx = conn.transaction()?;
    let current: Option<(Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT opened_period, closed_period FROM fs_bank_account_lifecycle WHERE company_id = ?1 AND bank = ?2 AND account_number = ?3",
            params![input.company_id, bank, account],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (old_opened, old_closed) = current.clone().unwrap_or((None, None));
    let need_period = || period.clone().ok_or_else(|| AppError::user("Falta el periodo de la cuenta."));
    let next = match input.action.as_str() {
        "opened" => Some((Some(need_period()?), old_closed.clone())),
        "closed" => Some((old_opened.clone(), Some(need_period()?))),
        "edited" => Some((validate_optional_period(&input.opened_period)?, validate_optional_period(&input.closed_period)?)),
        "kept_active" | "existed_before" => {
            need_period()?;
            None
        }
        _ => return Err(AppError::user("Acción no válida.")),
    };
    if let Some((opened, closed)) = &next {
        if let (Some(o), Some(c)) = (opened, closed) {
            if o > c {
                return Err(AppError::user("El cierre de la cuenta no puede ser anterior a su apertura."));
            }
        }
        let status = if closed.is_some() { "closed" } else { "active" };
        let now = now_iso();
        tx.execute(
            "INSERT INTO fs_bank_account_lifecycle (company_id, bank, account_number, opened_period, closed_period, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(company_id, bank, account_number) DO UPDATE SET opened_period = excluded.opened_period, closed_period = excluded.closed_period, status = excluded.status, updated_at = excluded.updated_at",
            params![input.company_id, bank, account, opened, closed, status, now],
        )?;
    }
    let previous = serde_json::json!({ "openedPeriod": old_opened, "closedPeriod": old_closed });
    let event_period = match (&next, input.action.as_str()) {
        (Some((opened, _)), "opened") => opened.clone(),
        (Some((_, closed)), "closed") => closed.clone(),
        _ => period,
    };
    tx.execute(
        "INSERT INTO fs_bank_account_events (company_id, bank, account_number, action, period, note, previous, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![input.company_id, bank, account, input.action, event_period, input.note.trim(), previous.to_string(), now_iso()],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn list_gmf_rules(conn: &Connection) -> AppResult<Vec<GmfRule>> {
    Ok(conn
        .prepare("SELECT bank, concept, is_gmf, origin, confirmed, updated_at FROM fs_bank_gmf_rules ORDER BY bank, concept")?
        .query_map([], |r| Ok(GmfRule { bank: r.get(0)?, concept: r.get(1)?, is_gmf: r.get(2)?, origin: r.get(3)?, confirmed: r.get(4)?, updated_at: r.get(5)? }))?
        .collect::<Result<_, _>>()?)
}

/// Banco + concepto exacto → GMF sí / no (confirmado por el usuario).
pub fn save_gmf_rule(conn: &Connection, bank: &str, concept: &str, is_gmf: bool, origin: &str) -> AppResult<()> {
    if bank.trim().is_empty() || concept.is_empty() {
        return Err(AppError::user("Falta el banco o el concepto."));
    }
    if !matches!(origin, "auto" | "manual") {
        return Err(AppError::user("Origen de clasificación no válido."));
    }
    let now = now_iso();
    conn.execute(
        "INSERT INTO fs_bank_gmf_rules (bank, concept, is_gmf, origin, confirmed, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
         ON CONFLICT(bank, concept) DO UPDATE SET is_gmf = excluded.is_gmf, origin = excluded.origin, confirmed = 1, updated_at = excluded.updated_at",
        params![bank.trim(), concept, is_gmf, origin, now],
    )?;
    Ok(())
}

/// «Reclasificar movimientos anteriores»: cambio explícito del PUC de movimientos
/// ya enviados (nunca automático). Respeta los periodos cerrados.
pub fn reclassify_movements(conn: &mut Connection, company_id: Option<i64>, ids: &[i64], puc_code: &str) -> AppResult<i64> {
    let concept = puc::assignable_concept(conn, puc_code)?.ok_or_else(|| AppError::user("El código PUC no se puede asignar."))?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let mut n = 0;
    let mut by_company: HashMap<i64, BTreeSet<String>> = HashMap::new();
    for id in ids {
        let row: Option<(i64, String, String)> = tx
            .query_row("SELECT company_id, accounting_date, puc_code FROM fs_movements WHERE id = ?1 AND status = 'active'", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()?;
        let Some((company, date, old)) = row else { continue };
        if company_id.is_some_and(|c| c != company) || old == puc_code {
            continue;
        }
        by_company.entry(company).or_default().insert(date);
        let detail: String = tx.query_row("SELECT detail FROM fs_movements WHERE id = ?1", [id], |r| r.get(0))?;
        let mut detail = json(detail);
        if let Value::Object(map) = &mut detail {
            let history = map.entry("reclassified").or_insert_with(|| Value::Array(vec![]));
            if let Value::Array(list) = history {
                list.push(serde_json::json!({ "from": old, "to": puc_code, "at": now }));
            }
        }
        tx.execute("UPDATE fs_movements SET puc_code = ?1, puc_concept = ?2, detail = ?3, updated_at = ?4 WHERE id = ?5", params![puc_code, concept, detail.to_string(), now, id])?;
        n += 1;
    }
    for (company, dates) in &by_company {
        ensure_open(&tx, *company, dates)?;
        invalidate_periods(&tx, *company, dates, REVIEW_NEW_MOVEMENTS)?;
    }
    tx.commit()?;
    Ok(n)
}

// ---------------------------------------------------------------------------
// Edición individual de movimientos (siempre trazable)
// ---------------------------------------------------------------------------

/// Edita un movimiento activo sin sobrescribirlo: el original pasa a «Ajustado»
/// y la versión corregida es un movimiento nuevo del mismo lote; o, si solo
/// cambia el estado, el original pasa a «Ignorado» / «Anulado». Cada edición
/// guarda motivo, antes y después en fs_movement_edits. Respeta los periodos
/// cerrados (fecha anterior y nueva) e invalida los periodos aprobados.
pub fn edit_movement(conn: &mut Connection, input: &MovementEditInput) -> AppResult<MovementEdit> {
    let reason = input.reason.trim();
    if reason.is_empty() {
        return Err(AppError::user("Escribe el motivo de la edición."));
    }
    if !["active", "ignored", "voided"].contains(&input.status.as_str()) {
        return Err(AppError::user("El estado elegido no es válido."));
    }
    let old = conn
        .query_row(&format!("SELECT {MOVEMENT_COLUMNS} FROM fs_movements WHERE id = ?1"), [input.movement_id], map_movement)
        .optional()?
        .ok_or_else(|| AppError::user("El movimiento no existe."))?;
    if old.status != "active" {
        return Err(AppError::user("Solo se edita la versión activa de un movimiento (las anteriores quedan en el historial)."));
    }
    if old.source == "adjustment" {
        return Err(AppError::user("Los ajustes manuales se editan desde Generador de Estados Financieros → Ajustes (conservan su propio historial)."));
    }
    let values_change = input.status == "active";
    let puc_code = input.puc_code.trim();
    let mut concept = input.puc_concept.trim().to_string();
    if values_change {
        validate_iso_date(&input.accounting_date, "Fecha contable")?;
        let catalog_concept = puc::assignable_concept(conn, puc_code)?.ok_or_else(|| AppError::user(format!("El código PUC «{puc_code}» no existe o no se puede asignar.")))?;
        if concept.is_empty() || puc_code != old.puc_code {
            concept = if puc_code == old.puc_code { old.puc_concept.clone() } else { catalog_concept };
        }
        if old.dc.is_some() && input.amount_cents < 0 {
            return Err(AppError::user("El valor de un movimiento bancario es absoluto: la dirección (salida / entrada) se conserva."));
        }
        let same = input.accounting_date == old.accounting_date && puc_code == old.puc_code && concept == old.puc_concept && input.description.trim() == old.description && input.amount_cents == old.amount_cents;
        if same {
            return Err(AppError::user("No hay cambios que guardar."));
        }
    }
    let mut dates = BTreeSet::from([old.accounting_date.clone()]);
    if values_change {
        dates.insert(input.accounting_date.clone());
    }
    ensure_open(conn, old.company_id, &dates)?;

    let snapshot = |date: &str, code: &str, concept: &str, description: &str, cents: i64, status: &str| {
        serde_json::json!({ "accountingDate": date, "pucCode": code, "pucConcept": concept, "description": description, "amountCents": cents, "status": status })
    };
    let previous = snapshot(&old.accounting_date, &old.puc_code, &old.puc_concept, &old.description, old.amount_cents, &old.status);
    let next = if values_change {
        snapshot(&input.accounting_date, puc_code, &concept, input.description.trim(), input.amount_cents, "active")
    } else {
        snapshot(&old.accounting_date, &old.puc_code, &old.puc_concept, &old.description, old.amount_cents, &input.status)
    };

    let tx = conn.transaction()?;
    let now = now_iso();
    let mut new_id = None;
    if values_change {
        let mut detail = old.detail.clone();
        if let Value::Object(map) = &mut detail {
            map.insert("editedFrom".into(), old.id.into());
        }
        tx.execute(
            "INSERT INTO fs_movements (company_id, batch_id, accounting_date, source, concept_key, document_id, document_number, document_type, supplier_id, supplier_nit, supplier_name, employee_id, employment_id, bank, account_number, puc_code, puc_concept, description, amount_cents, dc, settles_on, status, detail, created_at, updated_at)
             SELECT company_id, batch_id, ?2, source, concept_key, document_id, document_number, document_type, supplier_id, supplier_nit, supplier_name, employee_id, employment_id, bank, account_number, ?3, ?4, ?5, ?6, dc, settles_on, 'active', ?7, ?8, ?8
             FROM fs_movements WHERE id = ?1",
            params![old.id, input.accounting_date, puc_code, concept, input.description.trim(), input.amount_cents, detail.to_string(), now],
        )?;
        new_id = Some(tx.last_insert_rowid());
        tx.execute("UPDATE fs_movements SET status = 'adjusted', updated_at = ?1 WHERE id = ?2", params![now, old.id])?;
    } else {
        tx.execute("UPDATE fs_movements SET status = ?1, updated_at = ?2 WHERE id = ?3", params![input.status, now, old.id])?;
    }
    tx.execute(
        "INSERT INTO fs_movement_edits (company_id, original_movement_id, new_movement_id, reason, origin, previous, next, created_at) VALUES (?1, ?2, ?3, ?4, 'movements', ?5, ?6, ?7)",
        params![old.company_id, old.id, new_id, reason, previous.to_string(), next.to_string(), now],
    )?;
    let id = tx.last_insert_rowid();
    invalidate_periods(&tx, old.company_id, &dates, REVIEW_NEW_MOVEMENTS)?;
    tx.commit()?;
    Ok(MovementEdit { id, company_id: old.company_id, original_movement_id: old.id, new_movement_id: new_id, reason: reason.to_string(), origin: "movements".into(), previous, next, created_at: now })
}

pub fn list_movement_edits(conn: &Connection, company_id: i64) -> AppResult<Vec<MovementEdit>> {
    Ok(conn
        .prepare("SELECT id, company_id, original_movement_id, new_movement_id, reason, origin, previous, next, created_at FROM fs_movement_edits WHERE company_id = ?1 ORDER BY id")?
        .query_map([company_id], |r| {
            Ok(MovementEdit {
                id: r.get(0)?,
                company_id: r.get(1)?,
                original_movement_id: r.get(2)?,
                new_movement_id: r.get(3)?,
                reason: r.get(4)?,
                origin: r.get(5)?,
                previous: json(r.get(6)?),
                next: json(r.get(7)?),
                created_at: r.get(8)?,
            })
        })?
        .collect::<Result<_, _>>()?)
}

// ---------------------------------------------------------------------------
// Configuración global
// ---------------------------------------------------------------------------

pub fn list_puc_settings(conn: &Connection) -> AppResult<Vec<PucSetting>> {
    Ok(conn.prepare("SELECT key, puc_code FROM fs_puc_settings ORDER BY key")?.query_map([], |r| Ok(PucSetting { key: r.get(0)?, puc_code: r.get(1)? }))?.collect::<Result<_, _>>()?)
}

pub fn save_puc_settings(conn: &mut Connection, items: &[PucSetting]) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_iso();
    for s in items {
        let key = s.key.trim();
        let code = s.puc_code.trim();
        if key.is_empty() || key.len() > 80 {
            return Err(AppError::user("Configuración no válida."));
        }
        if puc::assignable_concept(&tx, code)?.is_none() {
            return Err(AppError::user(format!("El código PUC «{code}» no existe o no se puede asignar.")));
        }
        tx.execute(
            "INSERT INTO fs_puc_settings (key, puc_code, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET puc_code = excluded.puc_code, updated_at = excluded.updated_at",
            params![key, code, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn list_sales_doc_types(conn: &Connection) -> AppResult<Vec<SalesDocType>> {
    Ok(conn
        .prepare("SELECT normalized_label, original_label, category FROM fs_sales_doc_types ORDER BY normalized_label")?
        .query_map([], |r| Ok(SalesDocType { normalized_label: r.get(0)?, original_label: r.get(1)?, category: r.get(2)? }))?
        .collect::<Result<_, _>>()?)
}

pub fn save_sales_doc_type(conn: &Connection, normalized: &str, original: &str, category: &str) -> AppResult<()> {
    if !matches!(category, "sale" | "return" | "ignore") || normalized.trim().is_empty() {
        return Err(AppError::user("Elige Venta, Devolución o Ignorar."));
    }
    let now = now_iso();
    conn.execute(
        "INSERT INTO fs_sales_doc_types (normalized_label, original_label, category, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(normalized_label) DO UPDATE SET category = excluded.category, original_label = excluded.original_label, updated_at = excluded.updated_at",
        params![normalized.trim(), original.trim(), category, now],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Saldos iniciales (borrador)
// ---------------------------------------------------------------------------

pub fn get_opening_draft(conn: &Connection, company_id: i64, date: &str) -> AppResult<Option<Value>> {
    Ok(conn
        .query_row("SELECT rows FROM fs_opening_drafts WHERE company_id = ?1 AND balance_date = ?2", params![company_id, date], |r| r.get::<_, String>(0))
        .optional()?
        .map(json))
}

pub fn list_opening_dates(conn: &Connection, company_id: i64) -> AppResult<Vec<String>> {
    Ok(conn.prepare("SELECT balance_date FROM fs_opening_drafts WHERE company_id = ?1 ORDER BY balance_date DESC")?.query_map([company_id], |r| r.get(0))?.collect::<Result<_, _>>()?)
}

pub fn save_opening_draft(conn: &Connection, company_id: i64, date: &str, rows: &Value) -> AppResult<()> {
    company_exists(conn, company_id)?;
    validate_iso_date(date, "Fecha")?;
    if !rows.is_array() {
        return Err(AppError::user("Las filas no son válidas."));
    }
    conn.execute(
        "INSERT INTO fs_opening_drafts (company_id, balance_date, rows, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(company_id, balance_date) DO UPDATE SET rows = excluded.rows, updated_at = excluded.updated_at",
        params![company_id, date, rows.to_string(), now_iso()],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Nómina
// ---------------------------------------------------------------------------

pub fn list_employees(conn: &Connection, company_id: i64) -> AppResult<Vec<Employee>> {
    let mut employees: Vec<Employee> = conn
        .prepare("SELECT id, company_id, doc_type, doc_number, name FROM fs_employees WHERE company_id = ?1 ORDER BY name COLLATE NOCASE")?
        .query_map([company_id], |r| {
            Ok(Employee { id: r.get(0)?, company_id: r.get(1)?, doc_type: r.get(2)?, doc_number: r.get(3)?, name: r.get(4)?, areas: vec![], employments: vec![], liquidations: vec![], justifications: vec![], events: vec![] })
        })?
        .collect::<Result<_, _>>()?;
    for e in &mut employees {
        e.areas = conn
            .prepare("SELECT area, effective_from FROM fs_employee_areas WHERE employee_id = ?1 ORDER BY effective_from")?
            .query_map([e.id], |r| Ok(EmployeeArea { area: r.get(0)?, effective_from: r.get(1)? }))?
            .collect::<Result<_, _>>()?;
        e.employments = conn
            .prepare("SELECT id, number, hire_date, end_date FROM fs_employments WHERE employee_id = ?1 ORDER BY number")?
            .query_map([e.id], |r| Ok(Employment { id: r.get(0)?, number: r.get(1)?, hire_date: r.get(2)?, end_date: r.get(3)? }))?
            .collect::<Result<_, _>>()?;
        e.liquidations = conn
            .prepare("SELECT id, employee_id, employment_id, liquidation_date, last_period, prima_cents, cesantias_cents, intereses_cents, vacaciones_cents, notes, created_at FROM fs_liquidations WHERE employee_id = ?1 ORDER BY liquidation_date")?
            .query_map([e.id], map_liquidation)?
            .collect::<Result<_, _>>()?;
        e.justifications = conn
            .prepare("SELECT employee_id, period, justification, created_at FROM fs_absence_justifications WHERE employee_id = ?1 ORDER BY period")?
            .query_map([e.id], |r| Ok(AbsenceJustification { employee_id: r.get(0)?, period: r.get(1)?, justification: r.get(2)?, created_at: r.get(3)? }))?
            .collect::<Result<_, _>>()?;
        e.events = conn
            .prepare("SELECT action, previous, next, created_at FROM fs_employee_events WHERE employee_id = ?1 ORDER BY id")?
            .query_map([e.id], |r| Ok(EmployeeEvent { action: r.get(0)?, previous: json(r.get(1)?), next: json(r.get(2)?), created_at: r.get(3)? }))?
            .collect::<Result<_, _>>()?;
    }
    Ok(employees)
}

fn map_liquidation(r: &Row) -> rusqlite::Result<Liquidation> {
    Ok(Liquidation {
        id: r.get(0)?,
        employee_id: r.get(1)?,
        employment_id: r.get(2)?,
        liquidation_date: r.get(3)?,
        last_period: r.get(4)?,
        prima_cents: r.get(5)?,
        cesantias_cents: r.get(6)?,
        intereses_cents: r.get(7)?,
        vacaciones_cents: r.get(8)?,
        notes: r.get(9)?,
        created_at: r.get(10)?,
    })
}

/// Ficha de un empleado nuevo: tipo + número de documento (la llave), nombre,
/// fecha de ingreso (manual) y área contable. Abre la vinculación #1.
pub fn create_employee(conn: &mut Connection, input: &EmployeeInput) -> AppResult<i64> {
    company_exists(conn, input.company_id)?;
    let doc_type = input.doc_type.trim().to_uppercase();
    let doc_number: String = input.doc_number.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let name = input.name.trim();
    if doc_type.is_empty() || doc_number.is_empty() || name.is_empty() {
        return Err(AppError::user("Tipo de documento, número y nombre son obligatorios."));
    }
    validate_iso_date(&input.hire_date, "Fecha de ingreso")?;
    validate_area(&input.area)?;
    validate_period(&input.effective_from)?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO fs_employees (company_id, doc_type, doc_number, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![input.company_id, doc_type, doc_number, name, now],
    )
    .map_err(|e| match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => AppError::user(format!("Ya existe un empleado con {doc_type} {doc_number} en esta empresa.")),
        _ => e.into(),
    })?;
    let id = tx.last_insert_rowid();
    tx.execute("INSERT INTO fs_employments (employee_id, number, hire_date, created_at, updated_at) VALUES (?1, 1, ?2, ?3, ?3)", params![id, input.hire_date, now])?;
    tx.execute("INSERT INTO fs_employee_areas (employee_id, area, effective_from, created_at) VALUES (?1, ?2, ?3, ?4)", params![id, input.area, input.effective_from, now])?;
    tx.commit()?;
    Ok(id)
}

/// Área contable desde un periodo (AAAA-MM). No reescribe el histórico: agrega una vigencia.
pub fn set_employee_area(conn: &Connection, employee_id: i64, area: &str, effective_from: &str) -> AppResult<()> {
    validate_area(area)?;
    validate_period(effective_from)?;
    let previous = area_at(conn, employee_id, effective_from)?;
    conn.execute(
        "INSERT INTO fs_employee_areas (employee_id, area, effective_from, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(employee_id, effective_from) DO UPDATE SET area = excluded.area",
        params![employee_id, area, effective_from, now_iso()],
    )?;
    employee_event(conn, employee_id, "area_changed", serde_json::json!({ "area": previous }), serde_json::json!({ "area": area, "areaFrom": effective_from }))?;
    Ok(())
}

/// Área vigente en un periodo (la última vigencia que empezó en o antes de él).
fn area_at(conn: &Connection, employee_id: i64, period: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT area FROM fs_employee_areas WHERE employee_id = ?1 AND effective_from <= ?2 ORDER BY effective_from DESC LIMIT 1", params![employee_id, period], |r| r.get(0))
        .optional()?)
}

fn employee_event(conn: &Connection, employee_id: i64, action: &str, previous: Value, next: Value) -> AppResult<()> {
    conn.execute(
        "INSERT INTO fs_employee_events (employee_id, action, previous, next, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![employee_id, action, previous.to_string(), next.to_string(), now_iso()],
    )?;
    Ok(())
}

/// «Editar empleado»: corrige la ficha sin borrarla. El área nueva rige desde
/// `area_from` y nunca desde un mes con nómina ya enviada (esos meses conservan
/// su área; una corrección real se hace reemplazando el envío). Cada edición
/// queda en el historial con los valores anteriores.
pub fn update_employee(conn: &mut Connection, input: &EmployeeUpdateInput) -> AppResult<()> {
    let (old_type, old_number, old_name): (String, String, String) = conn
        .query_row("SELECT doc_type, doc_number, name FROM fs_employees WHERE id = ?1", [input.employee_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?
        .ok_or_else(|| AppError::user("El empleado no existe."))?;
    let doc_type = input.doc_type.trim().to_uppercase();
    let doc_number: String = input.doc_number.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let name = input.name.trim();
    if doc_type.is_empty() || doc_number.is_empty() || name.is_empty() {
        return Err(AppError::user("Tipo de documento, número y nombre son obligatorios."));
    }
    validate_iso_date(&input.hire_date, "Fecha de ingreso")?;
    // Vinculación vigente (la última): su fecha de ingreso es la editable.
    let (employment_id, old_hire, end): (i64, String, Option<String>) = conn.query_row(
        "SELECT id, hire_date, end_date FROM fs_employments WHERE employee_id = ?1 ORDER BY number DESC LIMIT 1",
        [input.employee_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if end.as_deref().is_some_and(|e| input.hire_date.as_str() > e) {
        return Err(AppError::user("La fecha de ingreso no puede ser posterior a la liquidación de la vinculación."));
    }
    let previous_end: Option<String> = conn
        .query_row("SELECT end_date FROM fs_employments WHERE employee_id = ?1 AND id <> ?2 ORDER BY number DESC LIMIT 1", params![input.employee_id, employment_id], |r| r.get(0))
        .optional()?
        .flatten();
    if previous_end.as_deref().is_some_and(|e| input.hire_date.as_str() <= e) {
        return Err(AppError::user("La fecha de ingreso debe ser posterior a la liquidación de la vinculación anterior."));
    }

    let area_change = match (input.area.as_deref().filter(|a| !a.is_empty()), input.area_from.as_deref().filter(|p| !p.is_empty())) {
        (Some(area), Some(from)) => {
            validate_area(area)?;
            validate_period(from)?;
            let current = area_at(conn, input.employee_id, from)?;
            if current.as_deref() == Some(area) {
                None
            } else {
                let last_sent: Option<String> = conn.query_row(
                    "SELECT MAX(p.period) FROM fs_payroll_rows p JOIN fs_batches b ON b.id = p.batch_id WHERE p.employee_id = ?1 AND b.status = 'active'",
                    [input.employee_id],
                    |r| r.get(0),
                )?;
                if let Some(last) = last_sent.filter(|l| from <= l.as_str()) {
                    return Err(AppError::user(format!(
                        "La nómina de {last} ya fue enviada con el área vigente: el cambio de área debe regir desde un mes posterior. Para corregir meses ya enviados, reemplaza el envío de esa planilla."
                    )));
                }
                Some((area.to_string(), from.to_string(), current))
            }
        }
        (Some(_), None) => return Err(AppError::user("Indica desde qué mes rige el área nueva.")),
        _ => None,
    };

    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute("UPDATE fs_employees SET doc_type = ?1, doc_number = ?2, name = ?3, updated_at = ?4 WHERE id = ?5", params![doc_type, doc_number, name, now, input.employee_id]).map_err(|e| match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => AppError::user(format!("Ya existe otro empleado con {doc_type} {doc_number} en esta empresa.")),
        _ => e.into(),
    })?;
    tx.execute("UPDATE fs_employments SET hire_date = ?1, updated_at = ?2 WHERE id = ?3", params![input.hire_date, now, employment_id])?;
    let mut previous = serde_json::Map::new();
    let mut next = serde_json::Map::new();
    let mut diff = |key: &str, old: &str, new: &str| {
        if old != new {
            previous.insert(key.into(), old.into());
            next.insert(key.into(), new.into());
        }
    };
    diff("docType", &old_type, &doc_type);
    diff("docNumber", &old_number, &doc_number);
    diff("name", &old_name, name);
    diff("hireDate", &old_hire, &input.hire_date);
    if let Some((area, from, current)) = &area_change {
        tx.execute(
            "INSERT INTO fs_employee_areas (employee_id, area, effective_from, created_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(employee_id, effective_from) DO UPDATE SET area = excluded.area",
            params![input.employee_id, area, from, now],
        )?;
        previous.insert("area".into(), current.clone().map_or(Value::Null, Value::from));
        next.insert("area".into(), area.as_str().into());
        next.insert("areaFrom".into(), from.as_str().into());
    }
    if !next.is_empty() {
        employee_event(&tx, input.employee_id, "edited", Value::Object(previous), Value::Object(next))?;
    }
    tx.commit()?;
    Ok(())
}

/// Reingreso: nueva vinculación con su propia fecha de ingreso. La anterior debe estar liquidada.
pub fn add_employment(conn: &Connection, employee_id: i64, hire_date: &str) -> AppResult<i64> {
    validate_iso_date(hire_date, "Fecha de ingreso")?;
    let last: Option<(i64, Option<String>)> =
        conn.query_row("SELECT number, end_date FROM fs_employments WHERE employee_id = ?1 ORDER BY number DESC LIMIT 1", [employee_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    let Some((number, end)) = last else { return Err(AppError::user("El empleado no existe.")) };
    match end {
        None => Err(AppError::user("La vinculación actual no está liquidada: registra la liquidación antes del reingreso.")),
        Some(end) if hire_date <= end.as_str() => Err(AppError::user("La fecha de reingreso debe ser posterior a la liquidación anterior.")),
        Some(_) => {
            let now = now_iso();
            conn.execute("INSERT INTO fs_employments (employee_id, number, hire_date, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)", params![employee_id, number + 1, hire_date, now])?;
            Ok(conn.last_insert_rowid())
        }
    }
}

const BENEFITS: [&str; 4] = ["prima", "cesantias", "intereses", "vacaciones"];

/// Liquidación: suma lo acumulado por pagar de la vinculación (prima, cesantías,
/// intereses y vacaciones) a la fecha, cierra la vinculación y deja esas
/// cuentas por pagar pagadas en esa fecha. El gasto ya causado no cambia.
pub fn register_liquidation(conn: &mut Connection, input: &LiquidationInput) -> AppResult<Liquidation> {
    validate_iso_date(&input.liquidation_date, "Fecha de liquidación")?;
    validate_period(&input.last_period)?;
    let (employee_id, company_id, end): (i64, i64, Option<String>) = conn
        .query_row(
            "SELECT e.id, e.company_id, j.end_date FROM fs_employments j JOIN fs_employees e ON e.id = j.employee_id WHERE j.id = ?1",
            [input.employment_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::user("La vinculación no existe."))?;
    if end.is_some() {
        return Err(AppError::user("Esta vinculación ya tiene liquidación."));
    }
    let date = input.liquidation_date.clone();
    ensure_open(conn, company_id, &BTreeSet::from([date.clone()]))?;
    let tx = conn.transaction()?;
    let mut totals = [0i64; 4];
    for (i, kind) in BENEFITS.iter().enumerate() {
        totals[i] = tx.query_row(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM fs_movements
             WHERE employment_id = ?1 AND status = 'active' AND concept_key = ?2 AND accounting_date <= ?3 AND (settles_on IS NULL OR settles_on > ?3)",
            params![input.employment_id, format!("payroll.{kind}.payable"), date],
            |r| r.get(0),
        )?;
    }
    let now = now_iso();
    tx.execute(
        "UPDATE fs_movements SET settles_on = ?1, updated_at = ?2
         WHERE employment_id = ?3 AND status = 'active' AND concept_key IN ('payroll.prima.payable', 'payroll.cesantias.payable', 'payroll.intereses.payable', 'payroll.vacaciones.payable')
           AND accounting_date <= ?1 AND (settles_on IS NULL OR settles_on > ?1)",
        params![date, now, input.employment_id],
    )?;
    tx.execute("UPDATE fs_employments SET end_date = ?1, updated_at = ?2 WHERE id = ?3", params![date, now, input.employment_id])?;
    tx.execute(
        "INSERT INTO fs_liquidations (company_id, employee_id, employment_id, liquidation_date, last_period, prima_cents, cesantias_cents, intereses_cents, vacaciones_cents, notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![company_id, employee_id, input.employment_id, date, input.last_period, totals[0], totals[1], totals[2], totals[3], input.notes.trim(), now],
    )?;
    let id = tx.last_insert_rowid();
    invalidate_periods(&tx, company_id, &BTreeSet::from([date]), REVIEW_NEW_MOVEMENTS)?;
    tx.commit()?;
    Ok(conn.query_row(
        "SELECT id, employee_id, employment_id, liquidation_date, last_period, prima_cents, cesantias_cents, intereses_cents, vacaciones_cents, notes, created_at FROM fs_liquidations WHERE id = ?1",
        [id],
        map_liquidation,
    )?)
}

/// «No se retiró / justificar ausencia»: texto obligatorio y persistente.
pub fn justify_absence(conn: &Connection, employee_id: i64, period: &str, justification: &str) -> AppResult<()> {
    validate_period(period)?;
    let text = justification.trim();
    if text.is_empty() {
        return Err(AppError::user("Escribe la justificación de la ausencia."));
    }
    let company_id: i64 = conn.query_row("SELECT company_id FROM fs_employees WHERE id = ?1", [employee_id], |r| r.get(0)).optional()?.ok_or_else(|| AppError::user("El empleado no existe."))?;
    conn.execute(
        "INSERT INTO fs_absence_justifications (company_id, employee_id, period, justification, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(employee_id, period) DO UPDATE SET justification = excluded.justification",
        params![company_id, employee_id, period, text, now_iso()],
    )?;
    Ok(())
}

/// Filas de planilla vigentes (de lotes activos).
pub fn list_payroll_rows(conn: &Connection, company_id: i64) -> AppResult<Vec<PayrollRow>> {
    Ok(conn
        .prepare(
            "SELECT p.id, p.batch_id, p.employee_id, p.employment_id, p.period, p.payment_date, p.detail, COALESCE(json_extract(b.metadata, '$.provider'), ''), b.file_name
             FROM fs_payroll_rows p JOIN fs_batches b ON b.id = p.batch_id WHERE p.company_id = ?1 AND b.status = 'active' ORDER BY p.period, p.id",
        )?
        .query_map([company_id], |r| Ok(PayrollRow { id: r.get(0)?, batch_id: r.get(1)?, employee_id: r.get(2)?, employment_id: r.get(3)?, period: r.get(4)?, payment_date: r.get(5)?, detail: json(r.get(6)?), provider: r.get(7)?, batch_file_name: r.get(8)? }))?
        .collect::<Result<_, _>>()?)
}

// ---------------------------------------------------------------------------
// Ajustes manuales
// ---------------------------------------------------------------------------

fn adjustment_values(input: &AdjustmentInput) -> AppResult<i64> {
    match input.adjustment_type.as_str() {
        "replace" => Ok(input.input_cents),
        "delta" => Ok(input.previous_cents + input.input_cents),
        _ => Err(AppError::user("Elige el tipo de ajuste.")),
    }
}

pub fn create_adjustment(conn: &mut Connection, input: &AdjustmentInput) -> AppResult<i64> {
    company_exists(conn, input.company_id)?;
    validate_iso_date(&input.accounting_date, "Fecha contable")?;
    let reason = input.reason.trim();
    if reason.is_empty() {
        return Err(AppError::user("Escribe el motivo del ajuste."));
    }
    let concept = puc::assignable_concept(conn, input.puc_code.trim())?.ok_or_else(|| AppError::user("El código PUC no se puede asignar."))?;
    let final_cents = adjustment_values(input)?;
    let delta = final_cents - input.previous_cents;
    let dates = BTreeSet::from([input.accounting_date.clone()]);
    ensure_open(conn, input.company_id, &dates)?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO fs_batches (company_id, source, file_name, period_label, period_start, period_end, dedupe_key, record_count, total_cents, status, metadata, created_at, updated_at)
         VALUES (?1, 'adjustment', '', ?2, ?3, ?3, '', 1, ?4, 'active', '{}', ?5, ?5)",
        params![input.company_id, format!("Ajuste {}", input.puc_code.trim()), input.accounting_date, delta, now],
    )?;
    let batch_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO fs_movements (company_id, batch_id, accounting_date, source, concept_key, puc_code, puc_concept, description, amount_cents, status, detail, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'adjustment', 'adjustment', ?4, ?5, ?6, ?7, 'active', '{}', ?8, ?8)",
        params![input.company_id, batch_id, input.accounting_date, input.puc_code.trim(), concept, reason, delta, now],
    )?;
    let movement_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO fs_adjustments (company_id, movement_id, accounting_date, puc_code, concept, reason, previous_cents, adjustment_type, input_cents, final_cents, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![input.company_id, movement_id, input.accounting_date, input.puc_code.trim(), concept, reason, input.previous_cents, input.adjustment_type, input.input_cents, final_cents, now],
    )?;
    let id = tx.last_insert_rowid();
    invalidate_periods(&tx, input.company_id, &dates, REVIEW_NEW_MOVEMENTS)?;
    tx.commit()?;
    Ok(id)
}

/// Edita un ajuste: guarda en el historial cómo estaba y actualiza su movimiento.
pub fn update_adjustment(conn: &mut Connection, id: i64, input: &AdjustmentInput) -> AppResult<()> {
    let old = list_adjustments(conn, input.company_id)?.into_iter().find(|a| a.id == id).ok_or_else(|| AppError::user("El ajuste no existe."))?;
    validate_iso_date(&input.accounting_date, "Fecha contable")?;
    let reason = input.reason.trim();
    if reason.is_empty() {
        return Err(AppError::user("Escribe el motivo del ajuste."));
    }
    let concept = puc::assignable_concept(conn, input.puc_code.trim())?.ok_or_else(|| AppError::user("El código PUC no se puede asignar."))?;
    let final_cents = adjustment_values(input)?;
    let dates = BTreeSet::from([old.accounting_date.clone(), input.accounting_date.clone()]);
    ensure_open(conn, input.company_id, &dates)?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let mut previous = serde_json::to_value(&old)?;
    if let Value::Object(map) = &mut previous {
        map.remove("history");
    }
    tx.execute("INSERT INTO fs_adjustment_history (adjustment_id, previous, edited_at) VALUES (?1, ?2, ?3)", params![id, previous.to_string(), now])?;
    tx.execute(
        "UPDATE fs_adjustments SET accounting_date = ?1, puc_code = ?2, concept = ?3, reason = ?4, previous_cents = ?5, adjustment_type = ?6, input_cents = ?7, final_cents = ?8, updated_at = ?9 WHERE id = ?10",
        params![input.accounting_date, input.puc_code.trim(), concept, reason, input.previous_cents, input.adjustment_type, input.input_cents, final_cents, now, id],
    )?;
    tx.execute(
        "UPDATE fs_movements SET accounting_date = ?1, puc_code = ?2, puc_concept = ?3, description = ?4, amount_cents = ?5, updated_at = ?6 WHERE id = ?7",
        params![input.accounting_date, input.puc_code.trim(), concept, reason, final_cents - input.previous_cents, now, old.movement_id],
    )?;
    invalidate_periods(&tx, input.company_id, &dates, REVIEW_NEW_MOVEMENTS)?;
    tx.commit()?;
    Ok(())
}

pub fn list_adjustments(conn: &Connection, company_id: i64) -> AppResult<Vec<Adjustment>> {
    let mut list: Vec<Adjustment> = conn
        .prepare(
            "SELECT id, company_id, movement_id, accounting_date, puc_code, concept, reason, previous_cents, adjustment_type, input_cents, final_cents, created_at, updated_at
             FROM fs_adjustments WHERE company_id = ?1 ORDER BY accounting_date DESC, id DESC",
        )?
        .query_map([company_id], |r| {
            Ok(Adjustment {
                id: r.get(0)?,
                company_id: r.get(1)?,
                movement_id: r.get(2)?,
                accounting_date: r.get(3)?,
                puc_code: r.get(4)?,
                concept: r.get(5)?,
                reason: r.get(6)?,
                previous_cents: r.get(7)?,
                adjustment_type: r.get(8)?,
                input_cents: r.get(9)?,
                final_cents: r.get(10)?,
                created_at: r.get(11)?,
                updated_at: r.get(12)?,
                history: vec![],
            })
        })?
        .collect::<Result<_, _>>()?;
    for a in &mut list {
        a.history = conn
            .prepare("SELECT previous, edited_at FROM fs_adjustment_history WHERE adjustment_id = ?1 ORDER BY id")?
            .query_map([a.id], |r| Ok(AdjustmentHistoryEntry { previous: json(r.get(0)?), edited_at: r.get(1)? }))?
            .collect::<Result<_, _>>()?;
    }
    Ok(list)
}

// ---------------------------------------------------------------------------
// Periodos, cierre y versiones
// ---------------------------------------------------------------------------

fn period_id(conn: &Connection, key: &PeriodKey) -> AppResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM fs_periods WHERE company_id = ?1 AND start_date = ?2 AND end_date = ?3 AND presentation = ?4",
            params![key.company_id, key.start_date, key.end_date, key.presentation],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn get_period(conn: &Connection, key: &PeriodKey) -> AppResult<Option<Period>> {
    let Some(id) = period_id(conn, key)? else { return Ok(None) };
    let mut p = conn.query_row(
        "SELECT id, company_id, start_date, end_date, presentation, status, validation_hash, review_reason, closed_snapshot, created_at, updated_at FROM fs_periods WHERE id = ?1",
        [id],
        |r| {
            Ok(Period {
                id: r.get(0)?,
                company_id: r.get(1)?,
                start_date: r.get(2)?,
                end_date: r.get(3)?,
                presentation: r.get(4)?,
                status: r.get(5)?,
                validation_hash: r.get(6)?,
                review_reason: r.get(7)?,
                closed_snapshot: r.get::<_, Option<String>>(8)?.map(json),
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
                events: vec![],
                versions: vec![],
            })
        },
    )?;
    p.events = conn
        .prepare("SELECT action, note, created_at FROM fs_period_events WHERE period_id = ?1 ORDER BY id")?
        .query_map([id], |r| Ok(PeriodEvent { action: r.get(0)?, note: r.get(1)?, created_at: r.get(2)? }))?
        .collect::<Result<_, _>>()?;
    p.versions = conn
        .prepare("SELECT id, version, file_name, snapshot, generated_at FROM fs_statement_versions WHERE period_id = ?1 ORDER BY version")?
        .query_map([id], |r| Ok(StatementVersion { id: r.get(0)?, version: r.get(1)?, file_name: r.get(2)?, snapshot: json(r.get(3)?), generated_at: r.get(4)? }))?
        .collect::<Result<_, _>>()?;
    Ok(Some(p))
}

/// Todos los periodos preparados de la empresa (para «Este periodo ya había sido preparado»).
pub fn list_periods(conn: &Connection, company_id: i64) -> AppResult<Vec<Period>> {
    let keys: Vec<PeriodKey> = conn
        .prepare("SELECT company_id, start_date, end_date, presentation FROM fs_periods WHERE company_id = ?1 ORDER BY end_date DESC, start_date DESC")?
        .query_map([company_id], |r| Ok(PeriodKey { company_id: r.get(0)?, start_date: r.get(1)?, end_date: r.get(2)?, presentation: r.get(3)? }))?
        .collect::<Result<_, _>>()?;
    keys.iter().map(|k| get_period(conn, k).map(|p| p.expect("periodo listado"))).collect()
}

fn ensure_period(tx: &Transaction, key: &PeriodKey) -> AppResult<i64> {
    if let Some(id) = period_id(tx, key)? {
        return Ok(id);
    }
    company_exists(tx, key.company_id)?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO fs_periods (company_id, start_date, end_date, presentation, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'preparing', ?5, ?5)",
        params![key.company_id, key.start_date, key.end_date, key.presentation, now],
    )?;
    let id = tx.last_insert_rowid();
    tx.execute("INSERT INTO fs_period_events (period_id, action, note, created_at) VALUES (?1, 'created', '', ?2)", params![id, now])?;
    Ok(id)
}

fn status_of(tx: &Transaction, id: i64) -> AppResult<String> {
    Ok(tx.query_row("SELECT status FROM fs_periods WHERE id = ?1", [id], |r| r.get(0))?)
}

fn set_status(tx: &Transaction, id: i64, status: &str, note: &str) -> AppResult<()> {
    let now = now_iso();
    tx.execute("UPDATE fs_periods SET status = ?1, updated_at = ?2 WHERE id = ?3", params![status, now, id])?;
    tx.execute("INSERT INTO fs_period_events (period_id, action, note, created_at) VALUES (?1, ?2, ?3, ?4)", params![id, status, note, now])?;
    Ok(())
}

/// «Cuadrado / Listo para generar» con la huella de los valores validados.
pub fn mark_ready(conn: &mut Connection, key: &PeriodKey, hash: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let id = ensure_period(&tx, key)?;
    if status_of(&tx, id)? == "closed" {
        return Err(AppError::user("El periodo está cerrado."));
    }
    tx.execute("UPDATE fs_periods SET validation_hash = ?1, review_reason = '' WHERE id = ?2", params![hash, id])?;
    set_status(&tx, id, "ready", "")?;
    tx.commit()?;
    Ok(())
}

/// Registra que el periodo necesita revisión (cambiaron los valores validados).
pub fn mark_needs_review(conn: &mut Connection, key: &PeriodKey, reason: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let Some(id) = period_id(&tx, key)? else { return Ok(()) };
    if matches!(status_of(&tx, id)?.as_str(), "ready" | "pdf_generated") {
        tx.execute("UPDATE fs_periods SET review_reason = ?1 WHERE id = ?2", params![reason, id])?;
        set_status(&tx, id, "needs_review", reason)?;
    }
    tx.commit()?;
    Ok(())
}

/// Nueva versión del PDF con su snapshot exacto. Nunca sobrescribe una anterior.
pub fn record_version(conn: &mut Connection, key: &PeriodKey, file_name: &str, snapshot: &Value) -> AppResult<StatementVersion> {
    let tx = conn.transaction()?;
    let id = ensure_period(&tx, key)?;
    let status = status_of(&tx, id)?;
    if status == "closed" {
        return Err(AppError::user("El periodo está cerrado: regenera una versión guardada o desbloquéalo."));
    }
    if !matches!(status.as_str(), "ready" | "pdf_generated") {
        return Err(AppError::user("El periodo no está cuadrado: valida los estados antes de generar el PDF."));
    }
    let version: i64 = tx.query_row("SELECT COALESCE(MAX(version), 0) + 1 FROM fs_statement_versions WHERE period_id = ?1", [id], |r| r.get(0))?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO fs_statement_versions (period_id, version, file_name, snapshot, generated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, version, file_name, snapshot.to_string(), now],
    )?;
    let vid = tx.last_insert_rowid();
    set_status(&tx, id, "pdf_generated", &format!("Versión {version}"))?;
    tx.commit()?;
    Ok(StatementVersion { id: vid, version, file_name: file_name.into(), snapshot: snapshot.clone(), generated_at: now })
}

/// Cierra / bloquea: solo desde «Cuadrado» o «PDF generado». Guarda lo aprobado.
pub fn close_period(conn: &mut Connection, key: &PeriodKey, snapshot: &Value) -> AppResult<()> {
    let tx = conn.transaction()?;
    let id = ensure_period(&tx, key)?;
    if !matches!(status_of(&tx, id)?.as_str(), "ready" | "pdf_generated") {
        return Err(AppError::user("Solo se puede cerrar un periodo cuadrado."));
    }
    tx.execute("UPDATE fs_periods SET closed_snapshot = ?1 WHERE id = ?2", params![snapshot.to_string(), id])?;
    set_status(&tx, id, "closed", "")?;
    tx.commit()?;
    Ok(())
}

/// Desbloquear (confirmado por el usuario): pierde el cierre y la aprobación previa.
pub fn unlock_period(conn: &mut Connection, key: &PeriodKey, note: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let Some(id) = period_id(&tx, key)? else { return Err(AppError::user("El periodo no existe.")) };
    if status_of(&tx, id)? != "closed" {
        return Err(AppError::user("El periodo no está cerrado."));
    }
    let reason = "Periodo desbloqueado: requiere nueva revisión antes de cerrarse otra vez.";
    tx.execute("UPDATE fs_periods SET validation_hash = NULL, review_reason = ?1 WHERE id = ?2", params![reason, id])?;
    set_status(&tx, id, "needs_review", if note.trim().is_empty() { reason } else { note.trim() })?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).unwrap();
        conn
    }

    fn company(conn: &Connection, nit: &str) -> i64 {
        conn.execute("INSERT INTO companies (razon_social, nit, created_at, updated_at) VALUES (?1, ?2, 'x', 'x')", params![format!("EMPRESA {nit}"), nit]).unwrap();
        conn.last_insert_rowid()
    }

    fn movement(date: &str, code: &str, cents: i64, doc: &str) -> MovementInput {
        MovementInput { accounting_date: date.into(), puc_code: code.into(), amount_cents: cents, document_id: doc.into(), ..Default::default() }
    }

    fn batch(company_id: i64, source: &str, key: &str, movements: Vec<MovementInput>) -> BatchInput {
        BatchInput {
            company_id,
            source: source.into(),
            file_name: "archivo.xlsx".into(),
            period_label: String::new(),
            period_start: None,
            period_end: None,
            dedupe_key: key.into(),
            replace: false,
            metadata: None,
            movements,
            bank_balances: vec![],
            bank_concept_mappings: vec![],
            payroll_rows: vec![],
            decisions: vec![],
        }
    }

    fn active(conn: &Connection, company_id: i64) -> Vec<(String, i64)> {
        list_movements(conn, company_id).unwrap().into_iter().filter(|m| m.status == "active").map(|m| (m.puc_code, m.amount_cents)).collect()
    }

    #[test]
    fn send_outcome_serializes_for_the_frontend() {
        let sent = serde_json::to_value(SendOutcome::Sent { batch_id: 3, replaced_batch_ids: vec![1], invalidated_periods: 0 }).unwrap();
        assert_eq!(sent, serde_json::json!({ "kind": "sent", "batchId": 3, "replacedBatchIds": [1], "invalidatedPeriods": 0 }));
        let dup = serde_json::to_value(SendOutcome::Duplicate { batches: vec![], repeated_documents: 2 }).unwrap();
        assert_eq!(dup, serde_json::json!({ "kind": "duplicate", "batches": [], "repeatedDocuments": 2 }));
    }

    #[test]
    fn seeds_catalog_and_7305_excluded() {
        let conn = db();
        let c = catalog(&conn).unwrap();
        assert_eq!(c.lines.len(), 41, "34 de 014 + 7 de 019");
        assert_eq!(c.sections.len(), 11);
        let disponible = c.lines.iter().find(|l| l.name == "Disponible").unwrap();
        assert_eq!(c.sections.iter().find(|s| s.section == "asset_current").unwrap().representative_line_id, Some(disponible.id));
        let m = list_mappings(&conn).unwrap();
        assert_eq!(m.len(), 1);
        assert!(m[0].puc_code == "7305" && m[0].excluded && m[0].line_id.is_none());
    }

    #[test]
    fn catalog_has_the_initial_lines_of_the_master_prompt() {
        let conn = db();
        let c = catalog(&conn).unwrap();
        let names = |section: &str| c.lines.iter().filter(|l| l.section == section).map(|l| l.name.as_str()).collect::<Vec<_>>();
        assert_eq!(names("asset_current"), ["Disponible", "Activos intangibles", "Deudores"]);
        assert_eq!(names("asset_noncurrent"), ["Propiedades, planta y equipo", "Deudores"]);
        assert_eq!(names("liability_noncurrent"), ["Otros pasivos", "Impuestos, gravámenes y tasas"]);
        assert_eq!(
            names("admin_expenses"),
            ["Gastos de personal", "Honorarios", "Arrendamientos", "Servicios", "Gastos legales", "Diversos", "Seguros", "Mantenimiento y reparaciones", "Adecuación e instalación", "Gastos de viaje"]
        );
        assert_eq!(names("sales_expenses"), ["Gastos de personal", "Servicios", "Diversos"]);
        assert_eq!(names("other_expenses"), ["Otros Gastos", "Otros Gastos financieros"]);
    }

    #[test]
    fn catalog_lines_can_be_created_renamed_ordered_and_deactivated() {
        let mut conn = db();
        let id = create_line(&conn, "asset_current", "Inventarios").unwrap();
        assert!(create_line(&conn, "income", "X").is_err(), "EERR: solo gastos operacionales por ahora");
        assert!(create_line(&conn, "admin_expenses", "  ").is_err());
        update_line(&conn, id, "Inventarios de mercancía", true).unwrap();
        let ids: Vec<i64> = catalog(&conn).unwrap().lines.iter().filter(|l| l.section == "asset_current").map(|l| l.id).collect();
        // Disponible, Activos intangibles, Deudores (019) y la nueva al final.
        let deudores = ids[2];
        assert_eq!(ids, [1, 2, deudores, id]);
        reorder_lines(&mut conn, "asset_current", &[id, 1, 2, deudores]).unwrap();
        assert!(reorder_lines(&mut conn, "asset_current", &[id, 1]).is_err(), "deben venir todas las líneas");
        let ids: Vec<i64> = catalog(&conn).unwrap().lines.iter().filter(|l| l.section == "asset_current").map(|l| l.id).collect();
        assert_eq!(ids, [id, 1, 2, deudores]);
        assert!(update_line(&conn, 1, "Disponible", false).unwrap_err().0.contains("representativa"));
        assert!(update_line(&conn, 14, "Capital social", false).unwrap_err().0.contains("estructura"));
        set_representative(&conn, "asset_current", id).unwrap();
        update_line(&conn, 1, "Disponible", false).unwrap();
        assert!(set_representative(&conn, "asset_current", 1).is_err(), "inactiva");
        assert!(set_representative(&conn, "asset_noncurrent", id).is_err(), "otra sección");
    }

    #[test]
    fn puc_mapping_is_explicit_and_traced() {
        let mut conn = db();
        set_mapping(&mut conn, "110505", Some(1), false).unwrap();
        set_mapping(&mut conn, "110505", None, true).unwrap();
        assert!(set_mapping(&mut conn, "999999", Some(1), false).is_err());
        assert!(set_mapping(&mut conn, "110510", None, false).is_err(), "sin línea ni exclusión no hay decisión");
        let history: i64 = conn.query_row("SELECT COUNT(*) FROM fs_puc_mapping_history WHERE puc_code = '110505'", [], |r| r.get(0)).unwrap();
        assert_eq!(history, 2);
        assert!(list_mappings(&conn).unwrap().iter().any(|m| m.puc_code == "110505" && m.excluded));
    }

    #[test]
    fn duplicates_stop_and_replacement_keeps_history() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        let first = batch(a, "purchases", "", vec![movement("2026-04-03", "513595", 10_000, "cufe1"), movement("2026-04-04", "513595", 5_000, "cufe2")]);
        let SendOutcome::Sent { batch_id: b1, .. } = send_batch(&mut conn, &first).unwrap() else { panic!() };
        // Mismo CUFE en otra importación: se detiene sin guardar nada.
        let again = batch(a, "purchases", "", vec![movement("2026-04-03", "513595", 12_000, "cufe1"), movement("2026-04-09", "513595", 1_000, "cufe3")]);
        match send_batch(&mut conn, &again).unwrap() {
            SendOutcome::Duplicate { batches, repeated_documents } => assert_eq!((batches.len(), batches[0].id, repeated_documents), (1, b1, 1)),
            _ => panic!("debe detectar el duplicado"),
        }
        assert_eq!(active(&conn, a).len(), 2, "no se guardó nada");
        // Reemplazar: el documento repetido queda «Reemplazado»; el resto del lote anterior sigue activo.
        let SendOutcome::Sent { replaced_batch_ids, .. } = send_batch(&mut conn, &BatchInput { replace: true, ..again }).unwrap() else { panic!() };
        assert!(replaced_batch_ids.is_empty(), "el lote anterior conserva cufe2");
        let mut now = active(&conn, a);
        now.sort();
        assert_eq!(now, [("513595".to_string(), 1_000), ("513595".to_string(), 5_000), ("513595".to_string(), 12_000)]);
        assert_eq!(list_movements(&conn, a).unwrap().iter().filter(|m| m.status == "replaced").count(), 1, "nunca se borra");
    }

    #[test]
    fn resending_the_same_statement_replaces_the_whole_batch() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        let mut first = batch(a, "bank", "bank:BBVA:7491:2026-08", vec![movement("2026-08-31", "530505", 9_000, "")]);
        first.bank_balances.push(BankBalanceInput { bank: "BBVA".into(), account_number: "7491".into(), balance_date: "2026-08-31".into(), balance_cents: 26_574_026_300, puc_code: "111005".into() });
        let SendOutcome::Sent { batch_id: b1, .. } = send_batch(&mut conn, &first).unwrap() else { panic!() };
        assert!(matches!(send_batch(&mut conn, &first).unwrap(), SendOutcome::Duplicate { .. }));
        let SendOutcome::Sent { batch_id: b2, replaced_batch_ids, .. } = send_batch(&mut conn, &BatchInput { replace: true, ..first }).unwrap() else { panic!() };
        assert_eq!(replaced_batch_ids, [b1]);
        let batches = list_batches(&conn, a).unwrap();
        let old = batches.iter().find(|b| b.id == b1).unwrap();
        assert_eq!((old.status.as_str(), old.replaced_by), ("replaced", Some(b2)));
        assert_eq!(active(&conn, a), [("530505".to_string(), 9_000)]);
        let balances = list_bank_balances(&conn, a).unwrap();
        assert_eq!(balances.iter().filter(|b| b.active).count(), 1, "el saldo del lote reemplazado ya no cuenta");
        assert_eq!(list_bank_accounts(&conn).unwrap()[0].puc_code, "111005");
    }

    #[test]
    fn companies_never_mix() {
        let mut conn = db();
        let (a, b) = (company(&conn, "900111111"), company(&conn, "900222222"));
        send_batch(&mut conn, &batch(a, "sales_einvoice", "", vec![movement("2026-01-10", "413595", 100, "x1")])).unwrap();
        // El mismo documento en otra empresa no es duplicado.
        assert!(matches!(send_batch(&mut conn, &batch(b, "sales_einvoice", "", vec![movement("2026-01-10", "413595", 200, "x1")])).unwrap(), SendOutcome::Sent { .. }));
        assert_eq!(active(&conn, a), [("413595".to_string(), 100)]);
        assert_eq!(active(&conn, b), [("413595".to_string(), 200)]);
    }

    #[test]
    fn rejects_unassignable_codes_and_empty_batches() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        assert!(send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-01-10", "5135", 1, "x")])).unwrap_err().0.contains("5135"));
        assert!(send_batch(&mut conn, &batch(a, "purchases", "", vec![])).is_err());
        assert!(send_batch(&mut conn, &batch(a, "otro", "", vec![movement("2026-01-10", "513595", 1, "x")])).is_err());
        assert!(send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-13-10", "513595", 1, "x")])).is_err());
        // 7305 (NO APLICA) sí se registra: queda para trazabilidad aunque no afecte los estados.
        assert!(matches!(send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-01-10", "7305", 1, "x")])).unwrap(), SendOutcome::Sent { .. }));
    }

    fn empty_input(company_id: i64, source: &str, months: &[&str], allow_with_data: bool) -> EmptyPeriodInput {
        EmptyPeriodInput { company_id, source: source.into(), months: months.iter().map(|m| m.to_string()).collect(), confirmation: "No hubo facturas de compra.".into(), allow_with_data }
    }

    #[test]
    fn empty_period_covers_without_movements_and_is_replaced_by_real_data() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        // Sin confirmación u origen no admitido: no se registra.
        assert!(register_empty_period(&mut conn, &EmptyPeriodInput { confirmation: " ".into(), ..empty_input(a, "purchases", &["2026-01"], false) }).is_err());
        assert!(register_empty_period(&mut conn, &empty_input(a, "bank", &["2026-01"], false)).is_err());

        let EmptyPeriodOutcome::Registered { batch_ids } = register_empty_period(&mut conn, &empty_input(a, "purchases", &["2026-01", "2026-02"], false)).unwrap() else { panic!() };
        assert_eq!(batch_ids.len(), 2);
        assert!(active(&conn, a).is_empty(), "no crea movimientos");
        let batches = list_batches(&conn, a).unwrap();
        assert!(batches.iter().all(|b| b.record_count == 0 && b.metadata["emptyPeriod"] == true && b.metadata["confirmedAt"].is_string()));
        assert_eq!(batches.iter().map(|b| b.period_end.clone().unwrap()).collect::<BTreeSet<_>>(), BTreeSet::from(["2026-01-31".to_string(), "2026-02-28".to_string()]));
        // Un mes ya registrado no se repite.
        let EmptyPeriodOutcome::Registered { batch_ids } = register_empty_period(&mut conn, &empty_input(a, "purchases", &["2026-01"], false)).unwrap() else { panic!() };
        assert!(batch_ids.is_empty());

        // Compras reales de enero: se pide reemplazar el registro vacío.
        let real = batch(a, "purchases", "", vec![movement("2026-01-10", "513595", 100, "f1")]);
        let SendOutcome::Duplicate { batches, .. } = send_batch(&mut conn, &real).unwrap() else { panic!("debe pedir reemplazar el registro vacío") };
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].metadata["emptyPeriod"], true);
        assert!(matches!(send_batch(&mut conn, &BatchInput { replace: true, ..real }).unwrap(), SendOutcome::Sent { .. }));
        let statuses: Vec<(String, String)> = list_batches(&conn, a).unwrap().into_iter().filter(|b| b.metadata["emptyPeriod"] == true).map(|b| (b.period_label, b.status)).collect();
        assert!(statuses.contains(&("2026-01".into(), "replaced".into())) && statuses.contains(&("2026-02".into(), "active".into())));

        // Enero ya tiene compras reales: advertencia explícita antes de registrarlo vacío.
        let EmptyPeriodOutcome::HasData { months } = register_empty_period(&mut conn, &empty_input(a, "purchases", &["2026-01"], false)).unwrap() else { panic!() };
        assert_eq!(months, ["2026-01"]);
        assert!(matches!(register_empty_period(&mut conn, &empty_input(a, "purchases", &["2026-01"], true)).unwrap(), EmptyPeriodOutcome::Registered { .. }));

        // Anular: queda «voided» con trazabilidad.
        let feb = list_batches(&conn, a).unwrap().into_iter().find(|b| b.period_label == "2026-02").unwrap();
        void_empty_period(&mut conn, feb.id, "Error").unwrap();
        assert!(void_empty_period(&mut conn, feb.id, "Error").is_err());
        let decisions: i64 = conn.query_row("SELECT COUNT(*) FROM fs_decisions WHERE decision LIKE 'empty_period%'", [], |r| r.get(0)).unwrap();
        assert_eq!(decisions, 4);
    }

    #[test]
    fn empty_period_respects_closed_periods() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-03-10", "513595", 100, "f1")])).unwrap();
        mark_ready(&mut conn, &key(a), "h").unwrap();
        close_period(&mut conn, &key(a), &serde_json::json!({})).unwrap();
        assert!(register_empty_period(&mut conn, &empty_input(a, "payroll", &["2026-02"], false)).unwrap_err().0.contains("periodo cerrado"));
        assert!(matches!(register_empty_period(&mut conn, &empty_input(a, "payroll", &["2026-09"], false)).unwrap(), EmptyPeriodOutcome::Registered { .. }));
    }

    #[test]
    fn stale_crypto_batch_leaves_the_calculation_but_stays_for_audit() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        let SendOutcome::Sent { batch_id, .. } = send_batch(&mut conn, &batch(a, "crypto_ops", "crypto:2026", vec![movement("2026-03-10", "413595", 500, "crypto:2026:sales")])).unwrap() else { panic!() };
        mark_ready(&mut conn, &key(a), "h").unwrap();
        assert_eq!(active(&conn, a), vec![("413595".to_string(), 500)]);
        let invalidated = void_crypto_batch(&mut conn, batch_id, "Hay duplicados sin resolver").unwrap();
        assert_eq!(invalidated, 1, "el periodo cuadrado vuelve a revisión");
        assert!(active(&conn, a).is_empty(), "ya no alimenta el cálculo vigente");
        let b = list_batches(&conn, a).unwrap().into_iter().find(|b| b.id == batch_id).unwrap();
        assert_eq!(b.status, "voided");
        assert_eq!(b.metadata["stale"], serde_json::json!(1));
        // Sus movimientos siguen ahí, anulados, para auditoría.
        assert_eq!(list_movements(&conn, a).unwrap().iter().filter(|m| m.status == "voided").count(), 1);
        // Un nuevo cálculo vuelve a ocupar la misma llave sin pedir reemplazo.
        assert!(matches!(send_batch(&mut conn, &batch(a, "crypto_ops", "crypto:2026", vec![movement("2026-03-10", "413595", 700, "crypto:2026:sales")])).unwrap(), SendOutcome::Sent { .. }));
        assert_eq!(active(&conn, a), vec![("413595".to_string(), 700)]);
        // Solo se retiran envíos activos de Transacciones Cripto.
        assert!(void_crypto_batch(&mut conn, batch_id, "otra vez").is_err());
    }

    #[test]
    fn outdated_crypto_batch_works_in_closed_periods_and_is_replaced_when_reopened() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        let SendOutcome::Sent { batch_id: other, .. } = send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-03-11", "513595", 100, "f1")])).unwrap() else { panic!() };
        let SendOutcome::Sent { batch_id, .. } = send_batch(&mut conn, &batch(a, "crypto_ops", "crypto:2026", vec![movement("2026-03-10", "413595", 500, "crypto:2026:sales")])).unwrap() else { panic!() };
        mark_ready(&mut conn, &key(a), "h").unwrap();
        close_period(&mut conn, &key(a), &serde_json::json!({})).unwrap();
        // Reemplazarlo en un periodo cerrado falla…
        let mut replacement = batch(a, "crypto_ops", "crypto:2026", vec![movement("2026-03-10", "413595", 900, "crypto:2026:sales")]);
        replacement.replace = true;
        assert!(send_batch(&mut conn, &replacement).unwrap_err().0.contains("periodo cerrado"));
        // …pero marcarlo desactualizado no toca movimientos ni periodos.
        mark_crypto_batch_outdated(&mut conn, batch_id, "El periodo está cerrado").unwrap();
        let b = list_batches(&conn, a).unwrap().into_iter().find(|b| b.id == batch_id).unwrap();
        assert_eq!(b.status, "active");
        assert_eq!(b.metadata["outdated"], serde_json::json!(1));
        assert_eq!(b.metadata["outdatedReason"], serde_json::json!("El periodo está cerrado"));
        assert_eq!(active(&conn, a).len(), 2, "los movimientos no se modifican (el Generador los ignora por la marca)");
        // Solo envíos activos de Transacciones Cripto.
        assert!(mark_crypto_batch_outdated(&mut conn, other, "x").is_err());
    }

    #[test]
    fn stale_crypto_batch_respects_closed_periods_and_other_sources() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        let SendOutcome::Sent { batch_id, .. } = send_batch(&mut conn, &batch(a, "crypto_ops", "crypto:2026", vec![movement("2026-03-10", "413595", 500, "d")])).unwrap() else { panic!() };
        let SendOutcome::Sent { batch_id: other, .. } = send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-03-11", "513595", 100, "f1")])).unwrap() else { panic!() };
        assert!(void_crypto_batch(&mut conn, other, "x").is_err());
        mark_ready(&mut conn, &key(a), "h").unwrap();
        close_period(&mut conn, &key(a), &serde_json::json!({})).unwrap();
        assert!(void_crypto_batch(&mut conn, batch_id, "x").unwrap_err().0.contains("periodo cerrado"));
        assert_eq!(active(&conn, a).len(), 2, "un periodo cerrado no se modifica");
    }

    fn key(company_id: i64) -> PeriodKey {
        PeriodKey { company_id, start_date: "2026-01-01".into(), end_date: "2026-08-31".into(), presentation: "bank".into() }
    }

    #[test]
    fn period_lifecycle_close_blocks_and_unlock_requires_review() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-03-01", "513595", 100, "d1")])).unwrap();
        let k = key(a);
        assert!(close_period(&mut conn, &k, &serde_json::json!({})).is_err(), "solo cuadrado");
        assert!(record_version(&mut conn, &k, "x.pdf", &serde_json::json!({})).is_err(), "sin cuadrar no hay PDF");
        mark_ready(&mut conn, &k, "h1").unwrap();
        let v1 = record_version(&mut conn, &k, "EEFF 08 2026 - EMPRESA.pdf", &serde_json::json!({"v": 1})).unwrap();
        assert_eq!(v1.version, 1);
        // Un movimiento nuevo dentro del rango invalida la validación.
        let SendOutcome::Sent { invalidated_periods, .. } = send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-05-01", "513595", 1, "d2")])).unwrap() else { panic!() };
        assert_eq!(invalidated_periods, 1);
        let p = get_period(&conn, &k).unwrap().unwrap();
        assert_eq!((p.status.as_str(), p.review_reason.as_str()), ("needs_review", REVIEW_NEW_MOVEMENTS));
        // Fuera del rango no lo afecta.
        mark_ready(&mut conn, &k, "h2").unwrap();
        send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-09-15", "513595", 1, "d3")])).unwrap();
        assert_eq!(get_period(&conn, &k).unwrap().unwrap().status, "ready");
        close_period(&mut conn, &k, &serde_json::json!({"aprobado": true})).unwrap();
        // Cerrado: nada entra, nada se reemplaza, no hay ajustes ni liquidaciones en el rango.
        let e = send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-02-01", "513595", 1, "d4")])).unwrap_err();
        assert!(e.0.starts_with(CLOSED_PERIOD));
        let replace = BatchInput { replace: true, ..batch(a, "purchases", "", vec![movement("2026-10-01", "513595", 1, "d1")]) };
        assert!(send_batch(&mut conn, &replace).unwrap_err().0.starts_with(CLOSED_PERIOD), "reemplazar un documento del periodo cerrado también se bloquea");
        let adj = AdjustmentInput { company_id: a, accounting_date: "2026-08-31".into(), puc_code: "110505".into(), reason: "Cuadre".into(), previous_cents: 0, adjustment_type: "replace".into(), input_cents: 5 };
        assert!(create_adjustment(&mut conn, &adj).is_err());
        assert!(record_version(&mut conn, &k, "x.pdf", &serde_json::json!({})).is_err());
        // Desbloquear: requiere nueva revisión y conserva las versiones.
        unlock_period(&mut conn, &k, "").unwrap();
        let p = get_period(&conn, &k).unwrap().unwrap();
        assert_eq!((p.status.as_str(), p.validation_hash.is_none(), p.versions.len()), ("needs_review", true, 1));
        assert!(close_period(&mut conn, &k, &serde_json::json!({})).is_err(), "debe volver a cuadrarse");
        create_adjustment(&mut conn, &adj).unwrap();
        mark_ready(&mut conn, &k, "h3").unwrap();
        let v2 = record_version(&mut conn, &k, "EEFF 08 2026 - EMPRESA.pdf", &serde_json::json!({"v": 2})).unwrap();
        assert_eq!(v2.version, 2);
        assert_eq!(get_period(&conn, &k).unwrap().unwrap().versions.len(), 2, "las versiones se conservan");
    }

    #[test]
    fn adjustments_keep_history_and_move_the_value() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        // Disponible actual 4.000.000 → debe quedar 10.000.000.
        let input = AdjustmentInput { company_id: a, accounting_date: "2026-08-31".into(), puc_code: "110505".into(), reason: "Cuadre de caja".into(), previous_cents: 400_000_000, adjustment_type: "replace".into(), input_cents: 1_000_000_000 };
        let id = create_adjustment(&mut conn, &input).unwrap();
        assert_eq!(active(&conn, a), [("110505".to_string(), 600_000_000)]);
        update_adjustment(&mut conn, id, &AdjustmentInput { adjustment_type: "delta".into(), input_cents: 500_000_000, ..input.clone() }).unwrap();
        assert_eq!(active(&conn, a), [("110505".to_string(), 500_000_000)]);
        let adj = &list_adjustments(&conn, a).unwrap()[0];
        assert_eq!((adj.final_cents, adj.history.len()), (900_000_000, 1));
        assert_eq!(adj.history[0].previous["finalCents"], 1_000_000_000);
        assert!(create_adjustment(&mut conn, &AdjustmentInput { reason: " ".into(), ..input }).is_err(), "motivo obligatorio");
    }

    #[test]
    fn payroll_employees_liquidation_and_rehire() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        let input = EmployeeInput { company_id: a, doc_type: "cc".into(), doc_number: "1.192.816.998".into(), name: "Carlos".into(), hire_date: "2026-01-01".into(), area: "admin".into(), effective_from: "2026-01".into() };
        let id = create_employee(&mut conn, &input).unwrap();
        assert!(create_employee(&mut conn, &input).unwrap_err().0.contains("CC 1192816998"), "la llave es tipo + número");
        set_employee_area(&conn, id, "sales", "2026-04").unwrap();
        let e = &list_employees(&conn, a).unwrap()[0];
        assert_eq!(e.areas.iter().map(|x| (x.area.as_str(), x.effective_from.as_str())).collect::<Vec<_>>(), [("admin", "2026-01"), ("sales", "2026-04")]);
        let employment = e.employments[0].id;
        // Provisiones de enero y febrero (prima por pagar hasta junio, cesantías hasta la liquidación).
        let mut b = batch(a, "payroll", "payroll:2026-01", vec![]);
        for (date, kind, cents) in [("2026-01-31", "prima", 16_666_700), ("2026-01-31", "cesantias", 16_666_700), ("2026-02-28", "prima", 16_666_700), ("2026-02-28", "vacaciones", 7_295_400)] {
            b.movements.push(MovementInput { accounting_date: date.into(), concept_key: format!("payroll.{kind}.payable"), puc_code: "251010".into(), amount_cents: cents, employee_id: Some(id), employment_id: Some(employment), document_id: format!("{date}{kind}"), ..Default::default() });
        }
        send_batch(&mut conn, &b).unwrap();
        assert!(add_employment(&conn, id, "2026-07-01").is_err(), "sin liquidar no hay reingreso");
        let liq = register_liquidation(&mut conn, &LiquidationInput { employment_id: employment, liquidation_date: "2026-02-28".into(), last_period: "2026-02".into(), notes: "Renuncia".into() }).unwrap();
        assert_eq!((liq.prima_cents, liq.cesantias_cents, liq.vacaciones_cents, liq.intereses_cents), (33_333_400, 16_666_700, 7_295_400, 0));
        assert!(list_movements(&conn, a).unwrap().iter().all(|m| m.settles_on.as_deref() == Some("2026-02-28")), "las cuentas por pagar quedan pagadas en la liquidación");
        assert!(register_liquidation(&mut conn, &LiquidationInput { employment_id: employment, liquidation_date: "2026-03-01".into(), last_period: "2026-02".into(), notes: String::new() }).is_err());
        // Reingreso en julio: vinculación #2, separada.
        assert!(add_employment(&conn, id, "2026-02-01").is_err());
        add_employment(&conn, id, "2026-07-01").unwrap();
        let e = &list_employees(&conn, a).unwrap()[0];
        assert_eq!(e.employments.iter().map(|j| (j.number, j.end_date.is_some())).collect::<Vec<_>>(), [(1, true), (2, false)]);
        justify_absence(&conn, id, "2026-03", "Licencia no remunerada").unwrap();
        assert!(justify_absence(&conn, id, "2026-04", "  ").is_err());
        assert_eq!(list_employees(&conn, a).unwrap()[0].justifications.len(), 1);
    }

    /// Lote de nómina de un operador con una fila por empleado (employee_id, employment_id).
    fn operator_batch(company_id: i64, provider: &str, key: &str, period: &str, people: &[(i64, i64)]) -> BatchInput {
        let mut b = batch(company_id, "payroll", key, vec![]);
        b.file_name = format!("planilla {provider}.pdf");
        b.metadata = Some(serde_json::json!({ "provider": provider }));
        for (employee, employment) in people {
            b.movements.push(MovementInput { accounting_date: format!("{period}-28"), concept_key: "payroll.salary.expense".into(), puc_code: "510506".into(), amount_cents: 100, employee_id: Some(*employee), employment_id: Some(*employment), document_id: format!("CC {employee}|{period}"), ..Default::default() });
            b.payroll_rows.push(PayrollRowInput { employee_id: *employee, employment_id: *employment, period: period.into(), payment_date: format!("{period}-28"), detail: None });
        }
        b
    }

    #[test]
    fn two_payroll_operators_complete_a_period_without_double_counting_an_employee() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        let mut people = vec![];
        for (n, doc) in ["111", "222", "333"].iter().enumerate() {
            let id = create_employee(&mut conn, &EmployeeInput { company_id: a, doc_type: "CC".into(), doc_number: (*doc).into(), name: format!("Persona {n}"), hire_date: "2026-01-01".into(), area: "admin".into(), effective_from: "2026-01".into() }).unwrap();
            people.push((id, list_employees(&conn, a).unwrap().into_iter().find(|e| e.id == id).unwrap().employments[0].id));
        }
        // Aportes en Línea envía a la primera persona y MiPlanilla a la segunda: el periodo se completa con dos lotes.
        assert!(matches!(send_batch(&mut conn, &operator_batch(a, "Aportes en Línea", "payroll:2026-01", "2026-01", &people[0..1])).unwrap(), SendOutcome::Sent { .. }));
        assert!(matches!(send_batch(&mut conn, &operator_batch(a, "MiPlanilla", "payroll:2026-01:mi-planilla:40724055", "2026-01", &people[1..2])).unwrap(), SendOutcome::Sent { .. }));
        let rows = list_payroll_rows(&conn, a).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows.iter().map(|r| r.provider.as_str()).collect::<Vec<_>>(), ["Aportes en Línea", "MiPlanilla"]);

        // La misma persona por otro operador se rechaza con el operador y el lote ya usados, también con «Reemplazar».
        let mut overlap = operator_batch(a, "MiPlanilla", "payroll:2026-01:mi-planilla:99999999", "2026-01", &people[0..1]);
        let err = send_batch(&mut conn, &overlap).unwrap_err().0;
        assert!(err.contains("Persona 0") && err.contains("Aportes en Línea") && err.contains("lote #"), "{err}");
        overlap.replace = true;
        assert!(send_batch(&mut conn, &overlap).is_err());
        assert_eq!(list_payroll_rows(&conn, a).unwrap().len(), 2, "no se guardó nada");

        // Mismo operador y misma planilla: el flujo normal de duplicado y reemplazo sigue funcionando.
        let mut again = operator_batch(a, "MiPlanilla", "payroll:2026-01:mi-planilla:40724055", "2026-01", &people[1..2]);
        assert!(matches!(send_batch(&mut conn, &again).unwrap(), SendOutcome::Duplicate { .. }));
        again.replace = true;
        assert!(matches!(send_batch(&mut conn, &again).unwrap(), SendOutcome::Sent { .. }));
        assert_eq!(list_payroll_rows(&conn, a).unwrap().len(), 2);

        // Un tercer empleado, de otra planilla de MiPlanilla, convive con los anteriores.
        assert!(matches!(send_batch(&mut conn, &operator_batch(a, "MiPlanilla", "payroll:2026-01:mi-planilla:55555555", "2026-01", &people[2..3])).unwrap(), SendOutcome::Sent { .. }));
        assert_eq!(list_payroll_rows(&conn, a).unwrap().len(), 3);
        // Otro periodo del mismo empleado no se confunde con el anterior.
        assert!(matches!(send_batch(&mut conn, &operator_batch(a, "MiPlanilla", "payroll:2026-02:mi-planilla:1", "2026-02", &people[0..1])).unwrap(), SendOutcome::Sent { .. }));
    }

    #[test]
    fn settings_and_sales_doc_types_persist() {
        let mut conn = db();
        save_puc_settings(&mut conn, &[PucSetting { key: "sales.einvoice".into(), puc_code: "413595".into() }]).unwrap();
        assert!(save_puc_settings(&mut conn, &[PucSetting { key: "x".into(), puc_code: "4135".into() }]).is_err());
        assert_eq!(list_puc_settings(&conn).unwrap()[0].puc_code, "413595");
        let types = list_sales_doc_types(&conn).unwrap();
        assert_eq!(types.iter().map(|t| t.category.as_str()).collect::<Vec<_>>(), ["sale", "return"]);
        save_sales_doc_type(&conn, "nota debito electronica", "Nota débito electrónica", "ignore").unwrap();
        assert!(save_sales_doc_type(&conn, "x", "x", "otro").is_err());
        assert!(run_pending(&mut conn).unwrap().is_empty());
        assert_eq!(list_sales_doc_types(&conn).unwrap().len(), 3);
    }

    #[test]
    fn reclassification_is_explicit_and_respects_closed_periods() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        send_batch(&mut conn, &batch(a, "bank", "k1", vec![movement("2026-08-31", "530505", 100, ""), movement("2026-09-30", "530505", 100, "")])).unwrap();
        let ids: Vec<i64> = list_movements(&conn, a).unwrap().iter().map(|m| m.id).collect();
        assert_eq!(reclassify_movements(&mut conn, Some(a), &ids, "530510").unwrap(), 2);
        assert!(list_movements(&conn, a).unwrap().iter().all(|m| m.puc_code == "530510" && m.detail["reclassified"][0]["from"] == "530505"));
        mark_ready(&mut conn, &key(a), "h").unwrap();
        close_period(&mut conn, &key(a), &serde_json::json!({})).unwrap();
        assert!(reclassify_movements(&mut conn, Some(a), &ids, "530505").is_err());
        assert!(list_movements(&conn, a).unwrap().iter().all(|m| m.puc_code == "530510"), "todo o nada");
    }

    #[test]
    fn movement_edit_keeps_the_original_and_respects_closed_periods() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-08-10", "513595", 10_000, "d1")])).unwrap();
        let original = list_movements(&conn, a).unwrap()[0].clone();
        let edit = |id: i64, cents: i64, reason: &str| MovementEditInput {
            movement_id: id,
            accounting_date: "2026-08-15".into(),
            puc_code: "513595".into(),
            puc_concept: String::new(),
            description: "Corregido".into(),
            amount_cents: cents,
            status: "active".into(),
            reason: reason.into(),
        };
        assert!(edit_movement(&mut conn, &edit(original.id, 12_000, " ")).is_err(), "motivo obligatorio");
        let e = edit_movement(&mut conn, &edit(original.id, 12_000, "Valor mal digitado")).unwrap();
        let all = list_movements(&conn, a).unwrap();
        let old = all.iter().find(|m| m.id == original.id).unwrap();
        let new = all.iter().find(|m| Some(m.id) == e.new_movement_id).unwrap();
        assert_eq!((old.status.as_str(), old.amount_cents), ("adjusted", 10_000), "el original no se sobrescribe");
        assert_eq!((new.status.as_str(), new.amount_cents, new.accounting_date.as_str(), new.batch_id), ("active", 12_000, "2026-08-15", old.batch_id));
        assert_eq!(new.detail["editedFrom"], original.id);
        assert_eq!((e.previous["amountCents"].as_i64(), e.next["amountCents"].as_i64()), (Some(10_000), Some(12_000)));
        assert!(edit_movement(&mut conn, &edit(original.id, 1, "otra vez")).is_err(), "solo la versión activa");
        // Anular solo cambia el estado.
        let voided = edit_movement(&mut conn, &MovementEditInput { status: "voided".into(), ..edit(new.id, 0, "Documento anulado por el proveedor") }).unwrap();
        assert_eq!(voided.new_movement_id, None);
        assert!(active(&conn, a).is_empty());
        assert_eq!(list_movement_edits(&conn, a).unwrap().len(), 2);
        // Periodo cerrado: bloquea.
        send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-03-01", "513595", 100, "d2")])).unwrap();
        mark_ready(&mut conn, &key(a), "h").unwrap();
        close_period(&mut conn, &key(a), &serde_json::json!({})).unwrap();
        let id = list_movements(&conn, a).unwrap().into_iter().find(|m| m.status == "active").unwrap().id;
        assert!(edit_movement(&mut conn, &edit(id, 5, "Cambio")).unwrap_err().0.starts_with(CLOSED_PERIOD));
    }

    #[test]
    fn company_with_financial_data_cannot_be_deleted() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-03-01", "513595", 100, "d1")])).unwrap();
        assert!(crate::database::companies::delete(&conn, a).unwrap_err().0.contains("Estados Financieros"));
        let b = company(&conn, "900222222");
        crate::database::companies::delete(&conn, b).unwrap();
    }

    #[test]
    fn bank_account_lifecycle_is_confirmed_editable_and_audited() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        let input = |action: &str, period: Option<&str>| BankLifecycleInput { company_id: a, bank: "Bancolombia".into(), account_number: "1234".into(), action: action.into(), period: period.map(String::from), opened_period: None, closed_period: None, note: String::new() };
        // «No, sigue activa»: solo auditoría, sin cierre.
        save_bank_lifecycle(&mut conn, &input("kept_active", Some("2026-03"))).unwrap();
        let l = &list_bank_lifecycles(&conn, a).unwrap()[0];
        assert_eq!((l.status.as_str(), l.closed_period.as_deref(), l.events.len()), ("active", None, 1));
        save_bank_lifecycle(&mut conn, &input("opened", Some("2026-04"))).unwrap();
        save_bank_lifecycle(&mut conn, &input("closed", Some("2026-06"))).unwrap();
        let l = &list_bank_lifecycles(&conn, a).unwrap()[0];
        assert_eq!((l.opened_period.as_deref(), l.closed_period.as_deref(), l.status.as_str()), (Some("2026-04"), Some("2026-06"), "closed"));
        assert!(save_bank_lifecycle(&mut conn, &input("closed", Some("2026-02"))).is_err(), "el cierre no puede ser anterior a la apertura");
        // Corrección: se quita el cierre y queda lo anterior en la auditoría.
        save_bank_lifecycle(&mut conn, &BankLifecycleInput { opened_period: Some("2026-04".into()), closed_period: None, note: "Error al confirmar".into(), ..input("edited", None) }).unwrap();
        let l = &list_bank_lifecycles(&conn, a).unwrap()[0];
        assert_eq!((l.closed_period.as_deref(), l.status.as_str(), l.events.len()), (None, "active", 4));
        assert_eq!(l.events[3].previous["closedPeriod"], "2026-06");
        assert!(save_bank_lifecycle(&mut conn, &input("closed", None)).is_err(), "el cierre necesita periodo");
        assert!(list_bank_lifecycles(&conn, company(&conn, "900222222")).unwrap().is_empty(), "por empresa");
    }

    #[test]
    fn gmf_rules_remember_confirmations_and_rejections() {
        let mut conn = db();
        save_gmf_rule(&conn, "BBVA", "IMPUESTO MOV FINANCIEROS", true, "auto").unwrap();
        save_gmf_rule(&conn, "BBVA", "GRAVAMEN ESPECIAL", false, "auto").unwrap();
        save_gmf_rule(&conn, "BBVA", "GRAVAMEN ESPECIAL", true, "manual").unwrap();
        assert!(save_gmf_rule(&conn, "BBVA", "X", true, "otro").is_err());
        let rules = list_gmf_rules(&conn).unwrap();
        assert_eq!(rules.iter().map(|r| (r.concept.as_str(), r.is_gmf, r.origin.as_str())).collect::<Vec<_>>(), [("GRAVAMEN ESPECIAL", true, "manual"), ("IMPUESTO MOV FINANCIEROS", true, "auto")]);
        assert!(run_pending(&mut conn).unwrap().is_empty());
    }

    #[test]
    fn employee_edit_keeps_area_history_and_audits() {
        let mut conn = db();
        let a = company(&conn, "900111111");
        let id = create_employee(&mut conn, &EmployeeInput { company_id: a, doc_type: "CC".into(), doc_number: "123".into(), name: "Ana".into(), hire_date: "2026-01-01".into(), area: "sales".into(), effective_from: "2026-01".into() }).unwrap();
        let employment = list_employees(&conn, a).unwrap()[0].employments[0].id;
        let mut b = batch(a, "payroll", "payroll:2026-06", vec![movement("2026-06-30", "510506", 100, "n1")]);
        b.payroll_rows.push(PayrollRowInput { employee_id: id, employment_id: employment, period: "2026-06".into(), payment_date: "2026-07-05".into(), detail: None });
        send_batch(&mut conn, &b).unwrap();
        let edit = |area_from: &str| EmployeeUpdateInput { employee_id: id, doc_type: "CC".into(), doc_number: "123".into(), name: "Ana María".into(), hire_date: "2026-01-02".into(), area: Some("admin".into()), area_from: Some(area_from.into()) };
        assert!(update_employee(&mut conn, &edit("2026-06")).unwrap_err().0.contains("2026-06"), "junio ya se envió con Ventas");
        update_employee(&mut conn, &edit("2026-07")).unwrap();
        let e = &list_employees(&conn, a).unwrap()[0];
        assert_eq!(e.areas.iter().map(|x| (x.area.as_str(), x.effective_from.as_str())).collect::<Vec<_>>(), [("sales", "2026-01"), ("admin", "2026-07")]);
        assert_eq!((e.name.as_str(), e.employments[0].hire_date.as_str()), ("Ana María", "2026-01-02"));
        assert_eq!((e.events.len(), e.events[0].previous["name"].as_str(), e.events[0].previous["area"].as_str()), (1, Some("Ana"), Some("sales")));
        // La nómina de junio conserva su área (el detalle enviado no cambia).
        assert_eq!(list_payroll_rows(&conn, a).unwrap()[0].period, "2026-06");
        let other = create_employee(&mut conn, &EmployeeInput { company_id: a, doc_type: "CC".into(), doc_number: "999".into(), name: "Luis".into(), hire_date: "2026-01-01".into(), area: "admin".into(), effective_from: "2026-01".into() }).unwrap();
        let dup = EmployeeUpdateInput { employee_id: other, doc_number: "123".into(), area: None, area_from: None, ..edit("2026-08") };
        assert!(update_employee(&mut conn, &dup).unwrap_err().0.contains("CC 123"));
    }

    #[test]
    fn retires_legacy_purchases_without_touching_the_new_module_or_empty_periods() {
        let mut conn = db();
        let a = company(&conn, "900");
        // Envío viejo (clave vacía) y viejo por documento.
        send_batch(&mut conn, &batch(a, "purchases", "", vec![movement("2026-03-10", "513595", 100, "old1")])).unwrap();
        send_batch(&mut conn, &batch(a, "purchases", "cufe-old", vec![movement("2026-04-10", "513595", 50, "old2")])).unwrap();
        // Lote del módulo nuevo y registro «Sin compras».
        send_batch(&mut conn, &batch(a, "purchases", "purchases:2026", vec![movement("2026-03-10", "513595", 100, "new1")])).unwrap();
        register_empty_period(&mut conn, &empty_input(a, "purchases", &["2026-05"], false)).unwrap();
        assert_eq!(active(&conn, a).iter().map(|m| m.1).sum::<i64>(), 250);

        assert_eq!(retire_legacy_purchases(&conn).unwrap(), 2);
        // Solo cuenta el lote nuevo: sin doble conteo.
        assert_eq!(active(&conn, a), vec![("513595".to_string(), 100)]);
        let voided: i64 = conn.query_row("SELECT COUNT(*) FROM fs_batches WHERE status = 'voided' AND json_extract(metadata, '$.legacy') = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(voided, 2);
        // Se conservan para auditoría (movimientos anulados, no borrados).
        let kept: i64 = conn.query_row("SELECT COUNT(*) FROM fs_movements WHERE status = 'voided'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 2);
        // El registro «Sin compras» sigue activo y la operación es idempotente.
        let empty: i64 = conn.query_row("SELECT COUNT(*) FROM fs_batches WHERE dedupe_key = 'empty:2026-05' AND status = 'active'", [], |r| r.get(0)).unwrap();
        assert_eq!(empty, 1);
        assert_eq!(retire_legacy_purchases(&conn).unwrap(), 0);
    }
}
