//! SMMLV por año: un valor en pesos enteros para cada año.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MinimumWage {
    pub year: i64,
    pub value_pesos: i64,
    pub updated_at: String,
}

pub fn validate_minimum_wage(year: i64, value_pesos: i64) -> AppResult<()> {
    if !(2000..=2100).contains(&year) {
        return Err(AppError::user("Escribe un año válido (2000 a 2100)."));
    }
    if !(1..=1_000_000_000).contains(&value_pesos) {
        return Err(AppError::user("El SMMLV debe ser mayor que cero."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_year_and_value() {
        assert!(validate_minimum_wage(2026, 1_750_905).is_ok());
        assert!(validate_minimum_wage(1999, 1_750_905).is_err());
        assert!(validate_minimum_wage(2026, 0).is_err());
        assert!(validate_minimum_wage(2026, -1).is_err());
    }
}
