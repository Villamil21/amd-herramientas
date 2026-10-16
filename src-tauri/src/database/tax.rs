//! Obligaciones tributarias: declaraciones DIAN por empresa y su historial.
//!
//! Reglas que se cumplen aquí, aunque la interfaz también las valide:
//! - El número de formulario es único: el mismo formulario no se guarda dos veces.
//! - Una declaración pertenece a una sola empresa (su NIT debe coincidir).
//! - Una segunda declaración del mismo impuesto y periodo solo entra como
//!   corrección explícita: la anterior queda «Reemplazada», nunca se borra.
//! - Los pagos se registran a mano (nunca se deducen de la presentación): una
//!   declaración con saldo a pagar puede tener 0, 1 o varios pagos y su suma
//!   nunca supera el saldo a pagar. El valor de la declaración no cambia.
//! - Una declaración afecta el ESF de toda fecha de corte posterior al fin de
//!   su periodo: si alguno de esos periodos de Estados Financieros está cerrado
//!   el cambio se bloquea; los «Cuadrado» o con PDF pasan a «Requiere nueva revisión».

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::clean;
use crate::models::tax::*;
use crate::services::time::now_iso;

pub const REVIEW_TAX_CHANGE: &str = "Este periodo había sido conciliado, pero cambió una declaración tributaria (o sus pagos) que afecta su fecha de corte.";
pub const PAYMENT_NO_BALANCE: &str = "La obligación no tiene saldo pendiente: no hay valor que aplicar a este pago.";
pub const EXCESS_KIND_REQUIRED: &str = "El pago supera el saldo pendiente: indica si el excedente es un interés o un excedente a favor.";
pub const CLOSED_TAX_PERIOD: &str = "Este cambio afecta un periodo de Estados Financieros cerrado.\nDesbloquea el periodo desde Generador de Estados Financieros.";

const COLUMNS: &str = "id, company_id, tax_type, year, period, periodicity, period_start, period_end, form_number, previous_form_number, is_correction, superseded_by, payable_cents, favor_cents, resolution, nit, company_name, file_name, income_ordinary_cents, income_loss_cents, advance_next_cents, advance_target_year, detail, created_at, updated_at";

fn map_return(r: &Row) -> rusqlite::Result<TaxReturn> {
    Ok(TaxReturn {
        id: r.get(0)?,
        company_id: r.get(1)?,
        tax_type: r.get(2)?,
        year: r.get(3)?,
        period: r.get(4)?,
        periodicity: r.get(5)?,
        period_start: r.get(6)?,
        period_end: r.get(7)?,
        form_number: r.get(8)?,
        previous_form_number: r.get(9)?,
        is_correction: r.get::<_, i64>(10)? != 0,
        superseded_by: r.get(11)?,
        payable_cents: r.get(12)?,
        favor_cents: r.get(13)?,
        resolution: r.get(14)?,
        nit: r.get(15)?,
        company_name: r.get(16)?,
        file_name: r.get(17)?,
        income_ordinary_cents: r.get(18)?,
        income_loss_cents: r.get(19)?,
        advance_next_cents: r.get(20)?,
        advance_target_year: r.get(21)?,
        detail: serde_json::from_str(&r.get::<_, String>(22)?).unwrap_or(Value::Null),
        created_at: r.get(23)?,
        updated_at: r.get(24)?,
        events: vec![],
        payments: vec![],
    })
}

fn get(conn: &Connection, id: i64) -> AppResult<TaxReturn> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM fs_tax_returns WHERE id = ?1"), [id], map_return)
        .optional()?
        .ok_or_else(|| AppError::user("La declaración no existe."))
}

pub fn list(conn: &Connection, company_id: i64) -> AppResult<Vec<TaxReturn>> {
    let mut returns: Vec<TaxReturn> = conn
        .prepare(&format!("SELECT {COLUMNS} FROM fs_tax_returns WHERE company_id = ?1 ORDER BY tax_type, year, period, id"))?
        .query_map([company_id], map_return)?
        .collect::<Result<_, _>>()?;
    let events: Vec<TaxReturnEvent> = conn
        .prepare("SELECT e.id, e.return_id, e.action, e.note, e.created_at FROM fs_tax_return_events e JOIN fs_tax_returns t ON t.id = e.return_id WHERE t.company_id = ?1 ORDER BY e.id")?
        .query_map([company_id], |r| Ok(TaxReturnEvent { id: r.get(0)?, return_id: r.get(1)?, action: r.get(2)?, note: r.get(3)?, created_at: r.get(4)? }))?
        .collect::<Result<_, _>>()?;
    for e in events {
        if let Some(r) = returns.iter_mut().find(|r| r.id == e.return_id) {
            r.events.push(e);
        }
    }
    let payments: Vec<TaxPayment> = conn
        .prepare(&format!("SELECT {PAYMENT_COLUMNS} FROM {PAYMENT_FROM} JOIN fs_tax_returns t ON t.id = p.return_id WHERE t.company_id = ?1 ORDER BY p.payment_date, p.id"))?
        .query_map([company_id], map_payment)?
        .collect::<Result<_, _>>()?;
    for p in payments {
        if let Some(r) = returns.iter_mut().find(|r| r.id == p.return_id) {
            r.payments.push(p);
        }
    }
    Ok(returns)
}

const PAYMENT_COLUMNS: &str = "p.id, p.return_id, p.payment_date, p.amount_cents, p.note, p.reference, p.created_at, p.updated_at, p.excess_cents, p.excess_kind, v.decision, v.fingerprint, v.decided_at";
const PAYMENT_FROM: &str = "fs_tax_payments p LEFT JOIN fs_tax_excess_reviews v ON v.payment_id = p.id";

fn map_payment(r: &Row) -> rusqlite::Result<TaxPayment> {
    let decision: Option<String> = r.get(10)?;
    let excess_review = match decision {
        Some(decision) => Some(ExcessReview { decision, fingerprint: r.get(11)?, decided_at: r.get(12)? }),
        None => None,
    };
    Ok(TaxPayment {
        id: r.get(0)?,
        return_id: r.get(1)?,
        payment_date: r.get(2)?,
        amount_cents: r.get(3)?,
        excess_cents: r.get(8)?,
        excess_kind: r.get(9)?,
        excess_review,
        note: r.get(4)?,
        reference: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

fn get_payment(conn: &Connection, id: i64) -> AppResult<TaxPayment> {
    conn.query_row(&format!("SELECT {PAYMENT_COLUMNS} FROM {PAYMENT_FROM} WHERE p.id = ?1"), [id], map_payment)
        .optional()?
        .ok_or_else(|| AppError::user("El pago no existe."))
}

/// Pagos de fechas anteriores a 018 (o de un backup anterior): cada fecha de pago es un pago por el saldo completo.
pub fn convert_legacy_payment_dates(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "INSERT INTO fs_tax_payments (return_id, payment_date, amount_cents, note, created_at, updated_at)
         SELECT t.id, t.payment_date, t.payable_cents, 'Fecha de pago registrada antes de los pagos parciales', t.updated_at, t.updated_at
         FROM fs_tax_returns t
         WHERE t.payment_date IS NOT NULL AND t.payable_cents > 0 AND t.resolution <> 'favor'
           AND NOT EXISTS (SELECT 1 FROM fs_tax_payments p WHERE p.return_id = t.id)",
        [],
    )?;
    Ok(())
}

fn event(tx: &Transaction, return_id: i64, action: &str, note: &str) -> AppResult<()> {
    tx.execute("INSERT INTO fs_tax_return_events (return_id, action, note, created_at) VALUES (?1, ?2, ?3, ?4)", params![return_id, action, note, now_iso()])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Periodos de Estados Financieros afectados
// ---------------------------------------------------------------------------

/// Periodos de la empresa cuya fecha final cae en [from, until) (until = None: sin límite).
fn affected_periods(conn: &Connection, company_id: i64, from: &str, until: Option<&str>, statuses: &str) -> AppResult<Vec<(i64, String, String)>> {
    let rows: Vec<(i64, String, String)> = conn
        .prepare(&format!("SELECT id, start_date, end_date FROM fs_periods WHERE company_id = ?1 AND status IN ({statuses})"))?
        .query_map([company_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    Ok(rows.into_iter().filter(|(_, _, end)| end.as_str() >= from && until.map_or(true, |u| end.as_str() < u)).collect())
}

fn ensure_open(conn: &Connection, company_id: i64, from: &str, until: Option<&str>) -> AppResult<()> {
    if let Some((_, s, e)) = affected_periods(conn, company_id, from, until, "'closed'")?.into_iter().next() {
        return Err(AppError::user(format!("{CLOSED_TAX_PERIOD}\n(Periodo cerrado: {s} a {e}.)")));
    }
    Ok(())
}

fn invalidate(tx: &Transaction, company_id: i64, from: &str, until: Option<&str>) -> AppResult<()> {
    let now = now_iso();
    for (id, _, _) in affected_periods(tx, company_id, from, until, "'ready', 'pdf_generated'")? {
        tx.execute("UPDATE fs_periods SET status = 'needs_review', review_reason = ?1, updated_at = ?2 WHERE id = ?3", params![REVIEW_TAX_CHANGE, now, id])?;
        tx.execute("INSERT INTO fs_period_events (period_id, action, note, created_at) VALUES (?1, 'needs_review', ?2, ?3)", params![id, REVIEW_TAX_CHANGE, now])?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Declaraciones
// ---------------------------------------------------------------------------

fn period_text(r: &TaxReturnInput) -> String {
    match r.period {
        Some(p) => format!("{} periodo {p}", r.year),
        None => format!("año gravable {}", r.year),
    }
}

pub fn save(conn: &mut Connection, input: &TaxReturnInput) -> AppResult<i64> {
    let input = input.validated()?;
    let (company_nit, company_name): (String, String) = conn
        .query_row("SELECT nit, razon_social FROM companies WHERE id = ?1", [input.company_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| AppError::user("La empresa no existe o fue eliminada."))?;
    let company_digits: String = company_nit.split('-').next().unwrap_or("").chars().filter(|c| c.is_ascii_digit()).collect();
    if !input.nit.is_empty() && input.nit != company_digits {
        return Err(AppError::user(format!("La declaración es del NIT {} y no de {company_name} (NIT {company_digits}). No se mezclan declaraciones entre empresas.", input.nit)));
    }
    if !input.form_number.is_empty() {
        let existing: Option<(String, i64, Option<i64>, String)> = conn
            .query_row(
                "SELECT c.razon_social, t.year, t.period, t.tax_type FROM fs_tax_returns t JOIN companies c ON c.id = t.company_id WHERE t.form_number = ?1",
                [&input.form_number],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        if let Some((name, year, period, _)) = existing {
            let when = period.map_or(format!("año {year}"), |p| format!("{year} periodo {p}"));
            return Err(AppError::user(format!("El formulario {} ya fue importado ({name}, {when}). No se duplica.", input.form_number)));
        }
    }

    // Declaración vigente del mismo impuesto y periodo: solo se reemplaza como corrección explícita.
    let current: Option<i64> = conn
        .query_row(
            "SELECT id FROM fs_tax_returns WHERE company_id = ?1 AND tax_type = ?2 AND year = ?3 AND period IS ?4 AND superseded_by IS NULL",
            params![input.company_id, input.tax_type, input.year, input.period],
            |r| r.get(0),
        )
        .optional()?;
    match (current, input.replaces_id) {
        (Some(id), Some(r)) if id == r => {}
        (Some(_), _) => {
            return Err(AppError::user(format!("Ya existe una declaración de {} para este impuesto. Si la nueva es una corrección, regístrala como corrección de la anterior.", period_text(&input))));
        }
        (None, Some(_)) => return Err(AppError::user("La declaración que se quiere corregir ya no está vigente.")),
        (None, None) => {}
    }

    ensure_open(conn, input.company_id, &input.period_end, None)?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO fs_tax_returns (company_id, tax_type, year, period, periodicity, period_start, period_end, form_number, previous_form_number, is_correction, payable_cents, favor_cents, nit, company_name, file_name, income_ordinary_cents, income_loss_cents, advance_next_cents, advance_target_year, detail, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21)",
        params![
            input.company_id,
            input.tax_type,
            input.year,
            input.period,
            input.periodicity,
            input.period_start,
            input.period_end,
            input.form_number,
            input.previous_form_number,
            input.is_correction as i64,
            input.payable_cents,
            input.favor_cents,
            input.nit,
            input.company_name,
            input.file_name,
            input.income_ordinary_cents,
            input.income_loss_cents,
            input.advance_next_cents,
            input.advance_target_year,
            input.detail.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "{}".into()),
            now,
        ],
    )?;
    let id = tx.last_insert_rowid();
    let note = if input.form_number.is_empty() { input.file_name.clone() } else { format!("Formulario {} · {}", input.form_number, input.file_name) };
    event(&tx, id, "imported", &note)?;
    if let Some(old) = input.replaces_id {
        tx.execute("UPDATE fs_tax_returns SET superseded_by = ?1, updated_at = ?2 WHERE id = ?3", params![id, now, old])?;
        event(&tx, old, "superseded", &format!("Reemplazada por la corrección #{id}"))?;
        event(&tx, id, "correction", &format!("Corrige la declaración #{old}"))?;
    }
    invalidate(&tx, input.company_id, &input.period_end, None)?;
    tx.commit()?;
    Ok(id)
}

// ---------------------------------------------------------------------------
// Pagos (totales o parciales)
// ---------------------------------------------------------------------------

/// Saldo a pagar que vale (si la declaración trae ambos y se resolvió «a favor», no hay nada que pagar).
fn effective_payable(r: &TaxReturn) -> i64 {
    if r.resolution == "favor" {
        0
    } else {
        r.payable_cents
    }
}

/// «$ 5.000.000,00» para el historial.
fn money(cents: i64) -> String {
    let pesos = (cents / 100).to_string();
    let mut grouped = String::new();
    for (i, c) in pesos.chars().enumerate() {
        if i > 0 && (pesos.len() - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(c);
    }
    format!("$ {grouped},{:02}", cents % 100)
}

fn paid_except(conn: &Connection, return_id: i64, except: Option<i64>) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COALESCE(SUM(amount_cents), 0) FROM fs_tax_payments WHERE return_id = ?1 AND id IS NOT ?2", params![return_id, except], |r| r.get(0))?)
}

/// Pago validado: lo aplicado a la obligación y, si lo pagado supera el saldo pendiente, el excedente con su clasificación.
struct ValidPayment {
    payment_date: String,
    applied_cents: i64,
    excess_cents: i64,
    excess_kind: String,
    note: String,
    reference: String,
}

/// Valida un pago nuevo o editado (`except` = el pago que se edita). Un pago mayor al saldo pendiente se separa en
/// valor aplicado y excedente; el excedente exige indicar si es interés o excedente a favor.
fn validated_payment(conn: &Connection, r: &TaxReturn, input: &TaxPaymentInput, except: Option<i64>) -> AppResult<ValidPayment> {
    if r.superseded_by.is_some() {
        return Err(AppError::user("La declaración fue reemplazada por una corrección: registra los pagos en la corrección."));
    }
    let payable = effective_payable(r);
    if payable <= 0 {
        return Err(AppError::user("Esta declaración no tiene saldo a pagar: los saldos a favor no llevan pagos."));
    }
    let date = input.payment_date.trim().to_string();
    if !is_iso_date(&date) {
        return Err(AppError::user("La fecha de pago no es válida."));
    }
    if date.as_str() < r.period_start.as_str() {
        return Err(AppError::user("La fecha de pago no puede ser anterior al inicio del periodo declarado."));
    }
    if input.amount_cents <= 0 {
        return Err(AppError::user("El valor del pago debe ser mayor que cero."));
    }
    let room = (payable - paid_except(conn, r.id, except)?).max(0);
    if room == 0 {
        return Err(AppError::user(PAYMENT_NO_BALANCE));
    }
    let applied = input.amount_cents.min(room);
    let excess = input.amount_cents - applied;
    let kind = input.excess_kind.trim();
    if excess > 0 && !EXCESS_KINDS.contains(&kind) {
        return Err(AppError::user(EXCESS_KIND_REQUIRED));
    }
    Ok(ValidPayment { payment_date: date, applied_cents: applied, excess_cents: excess, excess_kind: if excess > 0 { kind.to_string() } else { String::new() }, note: clean(&input.note, 500), reference: clean(&input.reference, 200) })
}

/// Cortes que cambian con un pago de esa fecha: desde la fecha (nunca antes del fin del periodo) en adelante.
fn from_date(r: &TaxReturn, date: &str) -> String {
    if date < r.period_end.as_str() {
        r.period_end.clone()
    } else {
        date.to_string()
    }
}

pub fn add_payment(conn: &mut Connection, return_id: i64, input: &TaxPaymentInput) -> AppResult<i64> {
    let r = get(conn, return_id)?;
    let p = validated_payment(conn, &r, input, None)?;
    let from = from_date(&r, &p.payment_date);
    ensure_open(conn, r.company_id, &from, None)?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO fs_tax_payments (return_id, payment_date, amount_cents, excess_cents, excess_kind, note, reference, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![return_id, p.payment_date, p.applied_cents, p.excess_cents, p.excess_kind, p.note, p.reference, now],
    )?;
    let id = tx.last_insert_rowid();
    event(&tx, return_id, "payment", &format!("Pago registrado: {} por {}{}", p.payment_date, money(p.applied_cents), excess_note(&p)))?;
    invalidate(&tx, r.company_id, &from, None)?;
    tx.commit()?;
    Ok(id)
}

/// Corrige la fecha y/o el valor de un pago. Si solo cambia la fecha, se afectan los cortes entre la anterior y la nueva.
pub fn update_payment(conn: &mut Connection, id: i64, input: &TaxPaymentInput) -> AppResult<()> {
    let old = get_payment(conn, id)?;
    let r = get(conn, old.return_id)?;
    let p = validated_payment(conn, &r, input, Some(id))?;
    if p.payment_date == old.payment_date && p.applied_cents == old.amount_cents && p.excess_cents == old.excess_cents && p.excess_kind == old.excess_kind && p.note == old.note && p.reference == old.reference {
        return Ok(());
    }
    let affects = p.payment_date != old.payment_date || p.applied_cents != old.amount_cents || p.excess_cents != old.excess_cents || p.excess_kind != old.excess_kind;
    let from = from_date(&r, old.payment_date.as_str().min(p.payment_date.as_str()));
    let until = if p.applied_cents == old.amount_cents && p.excess_cents == old.excess_cents && p.excess_kind == old.excess_kind { Some(old.payment_date.clone().max(p.payment_date.clone())) } else { None };
    if affects {
        ensure_open(conn, r.company_id, &from, until.as_deref())?;
    }
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE fs_tax_payments SET payment_date = ?1, amount_cents = ?2, excess_cents = ?3, excess_kind = ?4, note = ?5, reference = ?6, updated_at = ?7 WHERE id = ?8",
        params![p.payment_date, p.applied_cents, p.excess_cents, p.excess_kind, p.note, p.reference, now_iso(), id],
    )?;
    let note = if affects {
        format!("Pago editado: {} por {} → {} por {}{}", old.payment_date, money(old.amount_cents), p.payment_date, money(p.applied_cents), excess_note(&p))
    } else {
        format!("Pago del {} por {}: se editó la observación o la referencia", p.payment_date, money(p.applied_cents))
    };
    event(&tx, r.id, "payment", &note)?;
    if affects {
        invalidate(&tx, r.company_id, &from, until.as_deref())?;
    }
    tx.commit()?;
    Ok(())
}

pub fn delete_payment(conn: &mut Connection, id: i64) -> AppResult<()> {
    let p = get_payment(conn, id)?;
    let r = get(conn, p.return_id)?;
    let from = from_date(&r, &p.payment_date);
    ensure_open(conn, r.company_id, &from, None)?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM fs_tax_excess_reviews WHERE payment_id = ?1", [id])?;
    tx.execute("DELETE FROM fs_tax_payments WHERE id = ?1", [id])?;
    event(&tx, r.id, "payment", &format!("Pago eliminado: {} por {}", p.payment_date, money(p.amount_cents)))?;
    invalidate(&tx, r.company_id, &from, None)?;
    tx.commit()?;
    Ok(())
}

fn excess_note(p: &ValidPayment) -> String {
    match (p.excess_cents, p.excess_kind.as_str()) {
        (0, _) => String::new(),
        (c, "interest") => format!(" + {} de excedente clasificado como interés", money(c)),
        (c, _) => format!(" + {} de excedente a favor de la DIAN", money(c)),
    }
}

/// Decisión sobre un excedente a favor: entra (o no) a EEFF y 1008 a la vez. El pago original se conserva siempre.
pub fn set_excess_review(conn: &mut Connection, payment_id: i64, decision: &str, fingerprint: &str) -> AppResult<()> {
    if !EXCESS_DECISIONS.contains(&decision) || fingerprint.trim().is_empty() {
        return Err(AppError::user("Decisión no válida."));
    }
    let p = get_payment(conn, payment_id)?;
    if p.excess_cents <= 0 || p.excess_kind != "favor" {
        return Err(AppError::user("Este pago no tiene un excedente a favor por revisar."));
    }
    let r = get(conn, p.return_id)?;
    let from = from_date(&r, &p.payment_date);
    ensure_open(conn, r.company_id, &from, None)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO fs_tax_excess_reviews (payment_id, decision, fingerprint, decided_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(payment_id) DO UPDATE SET decision = excluded.decision, fingerprint = excluded.fingerprint, decided_at = excluded.decided_at",
        params![payment_id, decision, fingerprint.trim(), now_iso()],
    )?;
    let text = if decision == "applies" { "aplica a Estados Financieros y 1008" } else { "no aplica a Estados Financieros ni 1008" };
    event(&tx, r.id, "payment", &format!("Excedente a favor del pago del {} por {}: {text}", p.payment_date, money(p.excess_cents)))?;
    invalidate(&tx, r.company_id, &from, None)?;
    tx.commit()?;
    Ok(())
}

/// Guarda datos de la declaración que no vienen de su captura inicial: las casillas del Formulario 350 releídas del PDF
/// (`withholding`) y las decisiones manuales del usuario (`manual`, p. ej. la distribución de la casilla 129). No cambia valores declarados.
pub fn patch_detail(conn: &mut Connection, id: i64, patch: &Value, note: &str) -> AppResult<()> {
    let r = get(conn, id)?;
    let obj = patch.as_object().ok_or_else(|| AppError::user("Datos no válidos."))?;
    if obj.is_empty() || obj.keys().any(|k| k != "withholding" && k != "manual") {
        return Err(AppError::user("Solo se pueden guardar las casillas por concepto y las decisiones manuales."));
    }
    ensure_open(conn, r.company_id, &r.period_end, None)?;
    let mut detail = match &r.detail {
        Value::Object(m) => m.clone(),
        _ => serde_json::Map::new(),
    };
    for (k, v) in obj {
        detail.insert(k.clone(), v.clone());
    }
    let tx = conn.transaction()?;
    tx.execute("UPDATE fs_tax_returns SET detail = ?1, updated_at = ?2 WHERE id = ?3", params![Value::Object(detail).to_string(), now_iso(), id])?;
    event(&tx, id, "detail", &clean(note, 300))?;
    invalidate(&tx, r.company_id, &r.period_end, None)?;
    tx.commit()?;
    Ok(())
}

/// Declaración con saldo a pagar y a favor a la vez: el usuario decide cuál vale.
pub fn set_resolution(conn: &mut Connection, id: i64, resolution: &str) -> AppResult<()> {
    if !RESOLUTIONS.contains(&resolution) {
        return Err(AppError::user("Resolución no válida."));
    }
    let r = get(conn, id)?;
    if r.resolution == resolution {
        return Ok(());
    }
    if resolution == "favor" && paid_except(conn, id, None)? > 0 {
        return Err(AppError::user("La declaración tiene pagos registrados: elimínalos antes de indicar que vale el saldo a favor."));
    }
    ensure_open(conn, r.company_id, &r.period_end, None)?;
    let tx = conn.transaction()?;
    tx.execute("UPDATE fs_tax_returns SET resolution = ?1, updated_at = ?2 WHERE id = ?3", params![resolution, now_iso(), id])?;
    let note = match resolution {
        "payable" => "Revisada: vale el saldo a pagar",
        "favor" => "Revisada: vale el saldo a favor",
        _ => "Revisión reabierta",
    };
    event(&tx, id, "resolution", note)?;
    invalidate(&tx, r.company_id, &r.period_end, None)?;
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Configuración por empresa
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Periodos sin obligación
// ---------------------------------------------------------------------------

pub fn list_empty_periods(conn: &Connection, company_id: i64) -> AppResult<Vec<TaxEmptyPeriod>> {
    Ok(conn
        .prepare("SELECT id, company_id, tax_type, year, period, periodicity, confirmation, status, created_at, voided_at FROM fs_tax_empty_periods WHERE company_id = ?1 ORDER BY tax_type, year, period, id")?
        .query_map([company_id], |r| {
            Ok(TaxEmptyPeriod {
                id: r.get(0)?,
                company_id: r.get(1)?,
                tax_type: r.get(2)?,
                year: r.get(3)?,
                period: r.get(4)?,
                periodicity: r.get(5)?,
                confirmation: r.get(6)?,
                status: r.get(7)?,
                created_at: r.get(8)?,
                voided_at: r.get(9)?,
            })
        })?
        .collect::<Result<_, _>>()?)
}

/// Registra un periodo sin obligación. No se permite si ya hay una declaración
/// vigente de ese impuesto y periodo, ni si ya está registrado.
pub fn register_empty_period(conn: &Connection, input: &TaxEmptyPeriodInput) -> AppResult<i64> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)", [input.company_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::user("La empresa no existe."));
    }
    let valid = match input.tax_type.as_str() {
        "withholding" => input.periodicity == "monthly" && input.period.is_some_and(|p| (1..=12).contains(&p)),
        "vat" => match input.periodicity.as_str() {
            "bimonthly" => input.period.is_some_and(|p| (1..=6).contains(&p)),
            "four_monthly" => input.period.is_some_and(|p| (1..=3).contains(&p)),
            _ => false,
        },
        "income" => input.periodicity == "annual" && input.period.is_none(),
        _ => false,
    };
    if !valid || !(2000..=2100).contains(&input.year) {
        return Err(AppError::user("El periodo no es válido para este impuesto."));
    }
    if input.confirmation.trim().is_empty() {
        return Err(AppError::user("Confirma explícitamente que no hubo obligación en el periodo."));
    }
    let declared: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM fs_tax_returns WHERE company_id = ?1 AND tax_type = ?2 AND year = ?3 AND IFNULL(period, 0) = IFNULL(?4, 0) AND periodicity = ?5 AND superseded_by IS NULL)",
        params![input.company_id, input.tax_type, input.year, input.period, input.periodicity],
        |r| r.get(0),
    )?;
    if declared {
        return Err(AppError::user("Ese periodo ya tiene una declaración: no se puede registrar sin obligación."));
    }
    conn.execute(
        "INSERT INTO fs_tax_empty_periods (company_id, tax_type, year, period, periodicity, confirmation, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7)",
        params![input.company_id, input.tax_type, input.year, input.period, input.periodicity, input.confirmation.trim(), now_iso()],
    )
    .map_err(|e| match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => AppError::user("Ese periodo ya está registrado sin obligación."),
        _ => e.into(),
    })?;
    Ok(conn.last_insert_rowid())
}

/// Anula un registro (queda «voided» con su fecha; no se borra).
pub fn void_empty_period(conn: &Connection, id: i64) -> AppResult<()> {
    let n = conn.execute("UPDATE fs_tax_empty_periods SET status = 'voided', voided_at = ?1 WHERE id = ?2 AND status = 'active'", params![now_iso(), id])?;
    if n == 0 {
        return Err(AppError::user("El registro ya no está vigente. Recarga la pantalla."));
    }
    Ok(())
}

pub fn get_settings(conn: &Connection, company_id: i64) -> AppResult<TaxCompanySettings> {
    let vat: Option<Option<String>> = conn.query_row("SELECT vat_periodicity FROM fs_tax_company_settings WHERE company_id = ?1", [company_id], |r| r.get(0)).optional()?;
    Ok(TaxCompanySettings { company_id, vat_periodicity: vat.flatten() })
}

pub fn save_settings(conn: &mut Connection, settings: &TaxCompanySettings) -> AppResult<()> {
    let vat = settings.vat_periodicity.as_deref().filter(|v| !v.is_empty());
    if let Some(v) = vat {
        if !VAT_PERIODICITIES.contains(&v) {
            return Err(AppError::user("Periodicidad de IVA no válida."));
        }
    }
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)", [settings.company_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::user("La empresa no existe o fue eliminada."));
    }
    if get_settings(conn, settings.company_id)?.vat_periodicity.as_deref() == vat {
        return Ok(());
    }
    // Cambia qué declaraciones de IVA requieren revisión: afecta los cortes desde la primera declaración de IVA.
    let first_vat: Option<String> = conn.query_row("SELECT MIN(period_end) FROM fs_tax_returns WHERE company_id = ?1 AND tax_type = 'vat'", [settings.company_id], |r| r.get(0))?;
    if let Some(from) = &first_vat {
        ensure_open(conn, settings.company_id, from, None)?;
    }
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO fs_tax_company_settings (company_id, vat_periodicity, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(company_id) DO UPDATE SET vat_periodicity = excluded.vat_periodicity, updated_at = excluded.updated_at",
        params![settings.company_id, vat, now_iso()],
    )?;
    if let Some(from) = &first_vat {
        invalidate(&tx, settings.company_id, from, None)?;
    }
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

    fn withholding(company_id: i64, period: i64, form: &str, cents: i64) -> TaxReturnInput {
        let (start, end) = period_range("monthly", 2026, Some(period)).unwrap();
        TaxReturnInput {
            company_id,
            tax_type: "withholding".into(),
            year: 2026,
            period: Some(period),
            periodicity: "monthly".into(),
            period_start: start,
            period_end: end,
            form_number: form.into(),
            payable_cents: cents,
            nit: "901748281".into(),
            file_name: "Retefuente.pdf".into(),
            ..Default::default()
        }
    }

    fn period(conn: &Connection, company_id: i64, start: &str, end: &str, status: &str) -> i64 {
        conn.execute(
            "INSERT INTO fs_periods (company_id, start_date, end_date, presentation, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'bank', ?4, 'x', 'x')",
            params![company_id, start, end, status],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn status(conn: &Connection, id: i64) -> String {
        conn.query_row("SELECT status FROM fs_periods WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn same_form_is_never_saved_twice_and_companies_never_mix() {
        let mut conn = db();
        let a = company(&conn, "901748281-2");
        let b = company(&conn, "900111111");
        save(&mut conn, &withholding(a, 9, "3510699005229", 62_400_000)).unwrap();
        assert!(save(&mut conn, &withholding(a, 9, "3510699005229", 62_400_000)).unwrap_err().0.contains("ya fue importado"));
        assert!(save(&mut conn, &withholding(b, 9, "3510699005230", 1)).unwrap_err().0.contains("No se mezclan"));
        assert!(list(&conn, b).unwrap().is_empty());
        assert_eq!(list(&conn, a).unwrap()[0].events[0].action, "imported");
    }

    #[test]
    fn a_second_return_for_the_same_period_only_enters_as_a_correction() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        let first = save(&mut conn, &withholding(a, 9, "1", 100)).unwrap();
        assert!(save(&mut conn, &withholding(a, 9, "2", 200)).unwrap_err().0.contains("corrección"));
        let second = save(&mut conn, &TaxReturnInput { replaces_id: Some(first), previous_form_number: "1".into(), ..withholding(a, 9, "2", 200) }).unwrap();
        let all = list(&conn, a).unwrap();
        let old = all.iter().find(|r| r.id == first).unwrap();
        let new = all.iter().find(|r| r.id == second).unwrap();
        assert_eq!((old.superseded_by, new.is_correction, new.previous_form_number.as_str()), (Some(second), true, "1"));
        assert!(old.events.iter().any(|e| e.action == "superseded"), "la anterior conserva su historial");
    }

    fn pay(date: &str, cents: i64) -> TaxPaymentInput {
        TaxPaymentInput { payment_date: date.into(), amount_cents: cents, ..Default::default() }
    }

    #[test]
    fn partial_payments_never_exceed_the_payable_and_are_traced() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        let id = save(&mut conn, &withholding(a, 9, "1", 1_000_000_000)).unwrap();
        // Dos pagos el mismo día son válidos: cada uno con su identificador.
        let p1 = add_payment(&mut conn, id, &pay("2026-10-15", 200_000_000)).unwrap();
        let p2 = add_payment(&mut conn, id, &pay("2026-10-15", 300_000_000)).unwrap();
        assert_ne!(p1, p2);
        add_payment(&mut conn, id, &pay("2026-11-05", 300_000_000)).unwrap();
        // Pendiente $2.000.000: un pago de $3.000.000 exige clasificar el excedente (interés o a favor).
        assert_eq!(add_payment(&mut conn, id, &pay("2026-11-20", 300_000_000)).unwrap_err().0, EXCESS_KIND_REQUIRED);
        assert!(add_payment(&mut conn, id, &pay("2026-11-20", 0)).unwrap_err().0.contains("mayor que cero"));
        assert!(add_payment(&mut conn, id, &pay("2026-08-01", 100)).unwrap_err().0.contains("anterior al inicio"));
        // Editar respeta el mismo tope (sin contar el propio pago).
        assert_eq!(update_payment(&mut conn, p1, &pay("2026-10-15", 500_000_000)).unwrap_err().0, EXCESS_KIND_REQUIRED);
        update_payment(&mut conn, p1, &pay("2026-10-15", 400_000_000)).unwrap();
        let r = &list(&conn, a).unwrap()[0];
        assert_eq!(r.payable_cents, 1_000_000_000, "el valor de la declaración nunca cambia");
        assert_eq!(r.payments.iter().map(|p| p.amount_cents).sum::<i64>(), 1_000_000_000);
        assert!(r.events.iter().any(|e| e.note == "Pago editado: 2026-10-15 por $ 2.000.000,00 → 2026-10-15 por $ 4.000.000,00"));
        delete_payment(&mut conn, p2).unwrap();
        let r = &list(&conn, a).unwrap()[0];
        assert_eq!((r.payments.len(), r.events.last().unwrap().note.as_str()), (2, "Pago eliminado: 2026-10-15 por $ 3.000.000,00"));
    }

    #[test]
    fn a_payment_above_the_balance_splits_applied_and_excess_and_the_review_is_kept() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        let id = save(&mut conn, &withholding(a, 9, "1", 1_000_000_000)).unwrap();
        add_payment(&mut conn, id, &pay("2026-10-15", 600_000_000)).unwrap();
        // Pendiente $4.000.000: se pagan $5.000.000 → $4.000.000 aplicados y $1.000.000 de excedente a favor.
        let favor = add_payment(&mut conn, id, &TaxPaymentInput { excess_kind: "favor".into(), ..pay("2026-11-20", 500_000_000) }).unwrap();
        let r = &list(&conn, a).unwrap()[0];
        let p = r.payments.iter().find(|p| p.id == favor).unwrap();
        assert_eq!((p.amount_cents, p.excess_cents, p.excess_kind.as_str()), (400_000_000, 100_000_000, "favor"));
        assert!(p.excess_review.is_none());
        assert!(r.events.iter().any(|e| e.note.contains("excedente a favor de la DIAN")));
        // Ya sin saldo: no hay nada que aplicar.
        assert_eq!(add_payment(&mut conn, id, &pay("2026-11-25", 1)).unwrap_err().0, PAYMENT_NO_BALANCE);
        // Decisión persistida (con su huella); un pago sin excedente no se puede revisar.
        set_excess_review(&mut conn, favor, "not_applies", "huella").unwrap();
        let r = &list(&conn, a).unwrap()[0];
        let review = r.payments.iter().find(|p| p.id == favor).unwrap().excess_review.clone().unwrap();
        assert_eq!((review.decision.as_str(), review.fingerprint.as_str()), ("not_applies", "huella"));
        assert!(set_excess_review(&mut conn, r.payments[0].id, "applies", "x").is_err());
        assert!(set_excess_review(&mut conn, favor, "quizas", "x").is_err());
        // Eliminar el pago elimina su decisión, nunca al revés.
        delete_payment(&mut conn, favor).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM fs_tax_excess_reviews", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn detail_patch_keeps_declared_values_and_rejects_other_keys() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        let id = save(&mut conn, &withholding(a, 9, "1", 62_400_000)).unwrap();
        patch_detail(&mut conn, id, &serde_json::json!({ "manual": { "adjustments129": [{ "id": "a", "conceptKey": "services", "cents": 100, "note": "" }] } }), "Distribución casilla 129").unwrap();
        let r = &list(&conn, a).unwrap()[0];
        assert_eq!(r.payable_cents, 62_400_000);
        assert_eq!(r.detail["manual"]["adjustments129"][0]["conceptKey"], "services");
        assert!(patch_detail(&mut conn, id, &serde_json::json!({ "payable_cents": 1 }), "x").is_err());
    }

    #[test]
    fn payments_invalidate_open_cuts_and_respect_closed_periods() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        let id = save(&mut conn, &withholding(a, 9, "1", 62_400_000)).unwrap();
        let ready_aug = period(&conn, a, "2026-01-01", "2026-08-31", "ready");
        let ready_sep = period(&conn, a, "2026-01-01", "2026-09-30", "ready");
        let ready_oct = period(&conn, a, "2026-01-01", "2026-10-31", "ready");
        let p = add_payment(&mut conn, id, &pay("2026-10-15", 30_000_000)).unwrap();
        // Un pago del 15/10 solo cambia los cortes desde esa fecha.
        assert_eq!((status(&conn, ready_aug), status(&conn, ready_sep), status(&conn, ready_oct)), ("ready".into(), "ready".into(), "needs_review".into()));
        period(&conn, a, "2026-01-01", "2026-12-31", "closed");
        assert!(update_payment(&mut conn, p, &pay("2026-10-15", 20_000_000)).unwrap_err().0.contains("cerrado"));
        assert!(delete_payment(&mut conn, p).unwrap_err().0.contains("cerrado"));
        assert!(add_payment(&mut conn, id, &pay("2026-11-01", 1)).unwrap_err().0.contains("cerrado"));
        // Solo la observación: no afecta ningún corte, se permite.
        update_payment(&mut conn, p, &TaxPaymentInput { note: "Banco".into(), ..pay("2026-10-15", 30_000_000) }).unwrap();
    }

    #[test]
    fn favor_balances_and_superseded_returns_take_no_payments() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        let favor = save(&mut conn, &TaxReturnInput { payable_cents: 0, favor_cents: 500, ..withholding(a, 8, "1", 0) }).unwrap();
        assert!(add_payment(&mut conn, favor, &pay("2026-09-10", 100)).unwrap_err().0.contains("saldos a favor"));
        let both = save(&mut conn, &TaxReturnInput { favor_cents: 500, ..withholding(a, 9, "2", 1_000) }).unwrap();
        add_payment(&mut conn, both, &pay("2026-10-10", 100)).unwrap();
        assert!(set_resolution(&mut conn, both, "favor").unwrap_err().0.contains("pagos registrados"));
        let fixed = save(&mut conn, &TaxReturnInput { replaces_id: Some(both), ..withholding(a, 9, "3", 2_000) }).unwrap();
        assert!(add_payment(&mut conn, both, &pay("2026-10-11", 100)).unwrap_err().0.contains("reemplazada"));
        add_payment(&mut conn, fixed, &pay("2026-10-11", 2_000)).unwrap();
    }

    #[test]
    fn legacy_payment_dates_become_one_full_payment() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        let id = save(&mut conn, &withholding(a, 9, "1", 62_400_000)).unwrap();
        let favor = save(&mut conn, &TaxReturnInput { favor_cents: 1, ..withholding(a, 10, "2", 5) }).unwrap();
        conn.execute("UPDATE fs_tax_returns SET payment_date = '2026-10-15'", []).unwrap();
        conn.execute("UPDATE fs_tax_returns SET resolution = 'favor' WHERE id = ?1", [favor]).unwrap();
        convert_legacy_payment_dates(&conn).unwrap();
        convert_legacy_payment_dates(&conn).unwrap();
        let all = list(&conn, a).unwrap();
        let r = all.iter().find(|r| r.id == id).unwrap();
        assert_eq!(r.payments.iter().map(|p| (p.payment_date.as_str(), p.amount_cents)).collect::<Vec<_>>(), vec![("2026-10-15", 62_400_000)]);
        assert!(all.iter().find(|r| r.id == favor).unwrap().payments.is_empty());
    }

    #[test]
    fn import_invalidates_later_cuts_and_is_blocked_by_closed_ones() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        let before = period(&conn, a, "2026-01-01", "2026-08-31", "ready");
        let after = period(&conn, a, "2026-01-01", "2026-12-31", "pdf_generated");
        save(&mut conn, &withholding(a, 9, "1", 100)).unwrap();
        assert_eq!((status(&conn, before), status(&conn, after)), ("ready".into(), "needs_review".into()));
        period(&conn, a, "2026-10-01", "2026-10-31", "closed");
        assert!(save(&mut conn, &withholding(a, 10, "2", 100)).unwrap_err().0.contains("cerrado"));
    }

    #[test]
    fn vat_periodicity_per_company() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        assert_eq!(get_settings(&conn, a).unwrap().vat_periodicity, None);
        save_settings(&mut conn, &TaxCompanySettings { company_id: a, vat_periodicity: Some("bimonthly".into()) }).unwrap();
        assert_eq!(get_settings(&conn, a).unwrap().vat_periodicity.as_deref(), Some("bimonthly"));
        assert!(save_settings(&mut conn, &TaxCompanySettings { company_id: a, vat_periodicity: Some("monthly".into()) }).is_err());
    }

    #[test]
    fn company_with_tax_returns_cannot_be_deleted() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        save(&mut conn, &withholding(a, 9, "1", 100)).unwrap();
        assert!(crate::database::companies::delete(&conn, a).unwrap_err().0.contains("Estados Financieros"));
    }

    #[test]
    fn empty_tax_periods_cover_without_returns() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::database::migrations::run_pending(&mut conn).unwrap();
        conn.execute("INSERT INTO companies (razon_social, nit, created_at, updated_at) VALUES ('A', '900111111', 'x', 'x')", []).unwrap();
        let input = |tax: &str, period: Option<i64>, periodicity: &str| TaxEmptyPeriodInput { company_id: 1, tax_type: tax.into(), year: 2026, period, periodicity: periodicity.into(), confirmation: "Sin obligación".into() };
        let id = register_empty_period(&conn, &input("withholding", Some(3), "monthly")).unwrap();
        assert!(register_empty_period(&conn, &input("withholding", Some(3), "monthly")).unwrap_err().0.contains("ya está registrado"));
        assert!(register_empty_period(&conn, &input("withholding", Some(13), "monthly")).is_err());
        assert!(register_empty_period(&conn, &input("vat", Some(4), "four_monthly")).is_err());
        register_empty_period(&conn, &input("vat", Some(2), "bimonthly")).unwrap();
        register_empty_period(&conn, &input("income", None, "annual")).unwrap();
        assert!(register_empty_period(&conn, &TaxEmptyPeriodInput { confirmation: " ".into(), ..input("withholding", Some(4), "monthly") }).is_err());
        void_empty_period(&conn, id).unwrap();
        assert!(void_empty_period(&conn, id).is_err());
        // Anulado, el periodo se puede volver a registrar.
        register_empty_period(&conn, &input("withholding", Some(3), "monthly")).unwrap();
        let list = list_empty_periods(&conn, 1).unwrap();
        assert_eq!(list.iter().filter(|p| p.status == "active").count(), 3);
        assert_eq!(list.len(), 4);
    }

}
