//! Obligaciones tributarias: declaraciones DIAN por empresa y su historial.
//!
//! Reglas que se cumplen aquí, aunque la interfaz también las valide:
//! - El número de formulario es único: el mismo formulario no se guarda dos veces.
//! - Una declaración pertenece a una sola empresa (su NIT debe coincidir).
//! - Una segunda declaración del mismo impuesto y periodo solo entra como
//!   corrección explícita: la anterior queda «Reemplazada», nunca se borra.
//! - La fecha de pago se registra a mano (nunca se deduce de la presentación).
//! - Una declaración afecta el ESF de toda fecha de corte posterior al fin de
//!   su periodo: si alguno de esos periodos de Estados Financieros está cerrado
//!   el cambio se bloquea; los «Cuadrado» o con PDF pasan a «Requiere nueva revisión».

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::tax::*;
use crate::services::time::now_iso;

pub const REVIEW_TAX_CHANGE: &str = "Este periodo había sido conciliado, pero cambió una declaración tributaria (o su fecha de pago) que afecta su fecha de corte.";
pub const CLOSED_TAX_PERIOD: &str = "Este cambio afecta un periodo de Estados Financieros cerrado.\nDesbloquea el periodo desde Generador de Estados Financieros.";

const COLUMNS: &str = "id, company_id, tax_type, year, period, periodicity, period_start, period_end, form_number, previous_form_number, is_correction, superseded_by, payable_cents, favor_cents, payment_date, resolution, nit, company_name, file_name, income_ordinary_cents, income_loss_cents, advance_next_cents, advance_target_year, detail, created_at, updated_at";

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
        payment_date: r.get(14)?,
        resolution: r.get(15)?,
        nit: r.get(16)?,
        company_name: r.get(17)?,
        file_name: r.get(18)?,
        income_ordinary_cents: r.get(19)?,
        income_loss_cents: r.get(20)?,
        advance_next_cents: r.get(21)?,
        advance_target_year: r.get(22)?,
        detail: serde_json::from_str(&r.get::<_, String>(23)?).unwrap_or(Value::Null),
        created_at: r.get(24)?,
        updated_at: r.get(25)?,
        events: vec![],
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
    Ok(returns)
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

/// Registra, cambia o quita la fecha de pago. Solo afecta los cortes entre la fecha anterior y la nueva.
pub fn set_payment_date(conn: &mut Connection, id: i64, payment_date: Option<String>) -> AppResult<()> {
    let r = get(conn, id)?;
    let date = payment_date.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    if let Some(d) = &date {
        if !is_iso_date(d) {
            return Err(AppError::user("La fecha de pago no es válida."));
        }
        if d.as_str() < r.period_start.as_str() {
            return Err(AppError::user("La fecha de pago no puede ser anterior al inicio del periodo declarado."));
        }
    }
    if date == r.payment_date {
        return Ok(());
    }
    // Cortes afectados: desde la fecha más temprana (nunca antes del fin del periodo) hasta la más tardía (sin fecha = sin límite).
    let (a, b) = (r.payment_date.clone(), date.clone());
    let low = match (&a, &b) {
        (Some(x), Some(y)) => x.min(y).clone(),
        (Some(x), None) | (None, Some(x)) => x.clone(),
        (None, None) => unreachable!(),
    };
    let from = if low < r.period_end { r.period_end.clone() } else { low };
    let until = match (&a, &b) {
        (Some(x), Some(y)) => Some(x.max(y).clone()),
        _ => None,
    };
    ensure_open(conn, r.company_id, &from, until.as_deref())?;
    let tx = conn.transaction()?;
    tx.execute("UPDATE fs_tax_returns SET payment_date = ?1, updated_at = ?2 WHERE id = ?3", params![date, now_iso(), id])?;
    let note = match (&a, &b) {
        (None, Some(d)) => format!("Pagada el {d}"),
        (Some(old), Some(d)) => format!("Fecha de pago cambiada de {old} a {d}"),
        (Some(old), None) => format!("Se quitó la fecha de pago ({old})"),
        (None, None) => String::new(),
    };
    event(&tx, id, "payment", &note)?;
    invalidate(&tx, r.company_id, &from, until.as_deref())?;
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

    #[test]
    fn payment_date_is_traced_and_respects_closed_periods() {
        let mut conn = db();
        let a = company(&conn, "901748281");
        let id = save(&mut conn, &withholding(a, 9, "1", 62_400_000)).unwrap();
        let ready_sep = period(&conn, a, "2026-01-01", "2026-09-30", "ready");
        let ready_oct = period(&conn, a, "2026-01-01", "2026-10-31", "ready");
        let ready_aug = period(&conn, a, "2026-01-01", "2026-08-31", "ready");
        set_payment_date(&mut conn, id, Some("2026-10-15".into())).unwrap();
        // Con pago el 15/10 solo cambia el corte de octubre (en septiembre seguía pendiente: igual que antes).
        assert_eq!((status(&conn, ready_aug), status(&conn, ready_sep), status(&conn, ready_oct)), ("ready".into(), "ready".into(), "needs_review".into()));
        let r = &list(&conn, a).unwrap()[0];
        assert_eq!((r.payment_date.as_deref(), r.events.last().unwrap().note.as_str()), (Some("2026-10-15"), "Pagada el 2026-10-15"));
        period(&conn, a, "2026-01-01", "2026-12-31", "closed");
        assert!(set_payment_date(&mut conn, id, None).unwrap_err().0.contains("cerrado"));
        assert!(set_payment_date(&mut conn, id, Some("2026-08-01".into())).unwrap_err().0.contains("anterior al inicio"));
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
}
