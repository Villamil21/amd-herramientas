//! SMMLV por año.

use rusqlite::{params, Connection, ErrorCode};

use crate::error::{AppError, AppResult};
use crate::models::minimum_wage::MinimumWage;
use crate::services::time::now_iso;

pub fn list(conn: &Connection) -> AppResult<Vec<MinimumWage>> {
    let mut stmt = conn.prepare("SELECT year, value_pesos, updated_at, transport_allowance_pesos FROM minimum_wages ORDER BY year")?;
    let rows = stmt
        .query_map([], |r| Ok(MinimumWage { year: r.get(0)?, value_pesos: r.get(1)?, updated_at: r.get(2)?, transport_allowance_pesos: r.get(3)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Agrega un año nuevo, completo (SMMLV y auxilio de transporte). Un año ya
/// registrado no se duplica ni se sobrescribe: se edita.
pub fn create(conn: &Connection, year: i64, value_pesos: i64, transport_allowance_pesos: i64) -> AppResult<()> {
    if transport_allowance_pesos <= 0 {
        return Err(AppError::user(format!("Escribe el auxilio de transporte de {year}: un año no se guarda incompleto.")));
    }
    conn.execute(
        "INSERT INTO minimum_wages (year, value_pesos, updated_at, transport_allowance_pesos) VALUES (?1, ?2, ?3, ?4)",
        params![year, value_pesos, now_iso(), transport_allowance_pesos],
    )
        .map_err(|e| match &e {
            rusqlite::Error::SqliteFailure(f, _) if f.code == ErrorCode::ConstraintViolation => {
                AppError::user(format!("El SMMLV de {year} ya está registrado: edita su valor."))
            }
            _ => e.into(),
        })?;
    Ok(())
}

/// Cambia el valor de un año existente.
pub fn update(conn: &Connection, year: i64, value_pesos: i64) -> AppResult<()> {
    let n = conn.execute("UPDATE minimum_wages SET value_pesos = ?1, updated_at = ?2 WHERE year = ?3", params![value_pesos, now_iso(), year])?;
    if n == 0 {
        return Err(AppError::user(format!("El SMMLV de {year} ya no existe. Recarga la pantalla.")));
    }
    Ok(())
}

/// Auxilio de transporte de un año ya registrado (`None` lo deja sin configurar).
pub fn set_transport_allowance(conn: &Connection, year: i64, pesos: Option<i64>) -> AppResult<()> {
    let n = conn.execute("UPDATE minimum_wages SET transport_allowance_pesos = ?1, updated_at = ?2 WHERE year = ?3", params![pesos, now_iso(), year])?;
    if n == 0 {
        return Err(AppError::user(format!("Primero registra el SMMLV de {year}.")));
    }
    Ok(())
}

pub fn insert_full(conn: &Connection, w: &MinimumWage) -> AppResult<()> {
    conn.execute("INSERT INTO minimum_wages (year, value_pesos, updated_at, transport_allowance_pesos) VALUES (?1, ?2, ?3, ?4)", params![w.year, w.value_pesos, w.updated_at, w.transport_allowance_pesos])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    #[test]
    fn seeds_2026_creates_and_edits_without_duplicates() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        let years = |c: &Connection| list(c).unwrap().into_iter().map(|w| (w.year, w.value_pesos)).collect::<Vec<_>>();
        assert_eq!(years(&conn), [(2026, 1_750_905)]);
        // Un año nuevo exige el auxilio de transporte.
        assert!(create(&conn, 2027, 1_900_000, 0).unwrap_err().0.contains("auxilio de transporte"));
        create(&conn, 2027, 1_900_000, 255_000).unwrap();
        let dup = create(&conn, 2026, 1, 1).unwrap_err();
        assert_eq!(dup.0, "El SMMLV de 2026 ya está registrado: edita su valor.");
        update(&conn, 2027, 1_850_000).unwrap();
        assert!(update(&conn, 2030, 1).is_err());
        assert_eq!(years(&conn), [(2026, 1_750_905), (2027, 1_850_000)]);
        // Auxilio de transporte: 2026 viene configurado y 2027 se creó con el suyo.
        let aux = |c: &Connection| list(c).unwrap().into_iter().map(|w| w.transport_allowance_pesos).collect::<Vec<_>>();
        assert_eq!(aux(&conn), [Some(249_095), Some(255_000)]);
        set_transport_allowance(&conn, 2027, Some(260_000)).unwrap();
        assert!(set_transport_allowance(&conn, 2031, Some(1)).is_err());
        assert_eq!(aux(&conn), [Some(249_095), Some(260_000)]);
    }
}
