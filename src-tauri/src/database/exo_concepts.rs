//! Conceptos por formato de Información Exógena (1008 y los que vengan). Reutilizable: cada formato tiene los suyos y los
//! de uno nunca aparecen en otro. Los de sistema solo se activan o desactivan; los del usuario se crean, editan y eliminan.
//! Los registros ya creados guardan su propio código y descripción, así que desactivar o eliminar un concepto no los altera.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::time::now_iso;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FormatConcept {
    pub format_code: String,
    pub code: String,
    pub description: String,
    pub is_system: bool,
    pub is_active: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FormatConceptInput {
    pub format_code: String,
    pub code: String,
    pub description: String,
    pub is_active: bool,
}

fn valid_format(code: &str) -> AppResult<()> {
    if code.is_empty() || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::user("El código del formato no es válido."));
    }
    Ok(())
}

pub fn list(conn: &Connection, format_code: &str) -> AppResult<Vec<FormatConcept>> {
    valid_format(format_code)?;
    Ok(conn
        .prepare("SELECT format_code, code, description, is_system, is_active FROM exo_format_concepts WHERE format_code = ?1 ORDER BY code")?
        .query_map([format_code], |r| Ok(FormatConcept { format_code: r.get(0)?, code: r.get(1)?, description: r.get(2)?, is_system: r.get::<_, i64>(3)? != 0, is_active: r.get::<_, i64>(4)? != 0 }))?
        .collect::<Result<_, _>>()?)
}

pub fn save(conn: &Connection, input: &FormatConceptInput) -> AppResult<()> {
    valid_format(&input.format_code)?;
    let code = input.code.trim();
    if code.len() < 2 || code.len() > 8 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::user("El código del concepto debe ser numérico (de 2 a 8 dígitos)."));
    }
    let description = input.description.split_whitespace().collect::<Vec<_>>().join(" ");
    if description.chars().count() < 3 || description.chars().count() > 300 {
        return Err(AppError::user("Escribe la descripción del concepto (de 3 a 300 caracteres)."));
    }
    let existing: Option<(bool, String)> = conn
        .query_row("SELECT is_system, description FROM exo_format_concepts WHERE format_code = ?1 AND code = ?2", params![input.format_code, code], |r| Ok((r.get::<_, i64>(0)? != 0, r.get(1)?)))
        .ok();
    match existing {
        Some((true, original)) => {
            if description != original {
                return Err(AppError::user("La descripción de un concepto oficial no se puede cambiar; solo desactivarlo."));
            }
            conn.execute("UPDATE exo_format_concepts SET is_active = ?1, updated_at = ?2 WHERE format_code = ?3 AND code = ?4", params![input.is_active, now_iso(), input.format_code, code])?;
        }
        Some((false, _)) => {
            conn.execute("UPDATE exo_format_concepts SET description = ?1, is_active = ?2, updated_at = ?3 WHERE format_code = ?4 AND code = ?5", params![description, input.is_active, now_iso(), input.format_code, code])?;
        }
        None => {
            conn.execute(
                "INSERT INTO exo_format_concepts (format_code, code, description, is_system, is_active, updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?5)",
                params![input.format_code, code, description, input.is_active, now_iso()],
            )?;
        }
    }
    Ok(())
}

pub fn delete(conn: &Connection, format_code: &str, code: &str) -> AppResult<()> {
    valid_format(format_code)?;
    let system: Option<bool> = conn.query_row("SELECT is_system FROM exo_format_concepts WHERE format_code = ?1 AND code = ?2", params![format_code, code], |r| Ok(r.get::<_, i64>(0)? != 0)).ok();
    match system {
        None => Err(AppError::user("El concepto no existe.")),
        Some(true) => Err(AppError::user("Un concepto oficial no se elimina; desactívalo.")),
        Some(false) => {
            conn.execute("DELETE FROM exo_format_concepts WHERE format_code = ?1 AND code = ?2", params![format_code, code])?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::run_pending(&mut c).unwrap();
        c
    }

    fn input(format: &str, code: &str, description: &str) -> FormatConceptInput {
        FormatConceptInput { format_code: format.into(), code: code.into(), description: description.into(), is_active: true }
    }

    #[test]
    fn the_1008_official_concepts_are_seeded_and_scoped_to_their_format() {
        let c = db();
        let list_1008 = list(&c, "1008").unwrap();
        assert_eq!(list_1008.iter().map(|x| x.code.as_str()).collect::<Vec<_>>(), vec!["1315", "1316", "1317", "1318"]);
        assert!(list_1008.iter().all(|x| x.is_system && x.is_active));
        assert!(list_1008.iter().find(|x| x.code == "1316").unwrap().description.contains("accionistas, socios"));
        assert!(list(&c, "1009").unwrap().is_empty());
    }

    #[test]
    fn user_concepts_belong_to_one_format_and_official_ones_are_protected() {
        let c = db();
        save(&c, &input("1008", "1399", "Otro concepto propio")).unwrap();
        assert_eq!(list(&c, "1008").unwrap().len(), 5);
        assert!(list(&c, "1009").unwrap().is_empty(), "no se filtra a otros formatos");
        // Editar y desactivar uno propio.
        save(&c, &FormatConceptInput { is_active: false, ..input("1008", "1399", "Concepto renombrado") }).unwrap();
        let mine = list(&c, "1008").unwrap().into_iter().find(|x| x.code == "1399").unwrap();
        assert_eq!((mine.description.as_str(), mine.is_active), ("Concepto renombrado", false));
        // Los oficiales: se desactivan pero no se renombran ni se eliminan.
        save(&c, &FormatConceptInput { is_active: false, ..input("1008", "1316", "Saldo de las cuentas por cobrar a accionistas, socios, comuneros, cooperados y compañías vinculadas") }).unwrap();
        assert!(!list(&c, "1008").unwrap().iter().find(|x| x.code == "1316").unwrap().is_active);
        assert!(save(&c, &input("1008", "1316", "Otro texto")).is_err());
        assert!(delete(&c, "1008", "1316").is_err());
        delete(&c, "1008", "1399").unwrap();
        assert_eq!(list(&c, "1008").unwrap().len(), 4);
        assert!(delete(&c, "1008", "1399").is_err());
    }

    #[test]
    fn invalid_codes_and_descriptions_are_rejected() {
        let c = db();
        assert!(save(&c, &input("1008", "13a", "Texto válido")).is_err());
        assert!(save(&c, &input("1008", "1", "Texto válido")).is_err());
        assert!(save(&c, &input("1008", "1400", " x ")).is_err());
        assert!(save(&c, &input("10x8", "1400", "Texto válido")).is_err());
    }
}
