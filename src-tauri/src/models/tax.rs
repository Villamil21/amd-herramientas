//! Obligaciones tributarias (Retención en la fuente, IVA y Renta) de Estados
//! Financieros. La lectura del formulario ocurre en el frontend; aquí se
//! validan y guardan las declaraciones. Valores en centavos enteros.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::clean;

pub const TAX_TYPES: [&str; 3] = ["withholding", "vat", "income"];
pub const VAT_PERIODICITIES: [&str; 2] = ["bimonthly", "four_monthly"];
pub const RESOLUTIONS: [&str; 3] = ["", "payable", "favor"];

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaxReturnEvent {
    pub id: i64,
    pub return_id: i64,
    pub action: String,
    pub note: String,
    pub created_at: String,
}

/// Pago (total o parcial) de una declaración con saldo a pagar.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaxPayment {
    pub id: i64,
    pub return_id: i64,
    pub payment_date: String,
    pub amount_cents: i64,
    pub note: String,
    pub reference: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaxPaymentInput {
    pub payment_date: String,
    pub amount_cents: i64,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub reference: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaxReturn {
    pub id: i64,
    pub company_id: i64,
    pub tax_type: String,
    pub year: i64,
    pub period: Option<i64>,
    pub periodicity: String,
    pub period_start: String,
    pub period_end: String,
    pub form_number: String,
    pub previous_form_number: String,
    pub is_correction: bool,
    pub superseded_by: Option<i64>,
    pub payable_cents: i64,
    pub favor_cents: i64,
    pub resolution: String,
    pub nit: String,
    pub company_name: String,
    pub file_name: String,
    pub income_ordinary_cents: Option<i64>,
    pub income_loss_cents: Option<i64>,
    pub advance_next_cents: Option<i64>,
    pub advance_target_year: Option<i64>,
    pub detail: Value,
    pub created_at: String,
    pub updated_at: String,
    pub events: Vec<TaxReturnEvent>,
    /// Pagos registrados (0, 1 o varios), por fecha.
    pub payments: Vec<TaxPayment>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaxReturnInput {
    pub company_id: i64,
    pub tax_type: String,
    pub year: i64,
    pub period: Option<i64>,
    pub periodicity: String,
    pub period_start: String,
    pub period_end: String,
    pub form_number: String,
    pub previous_form_number: String,
    pub is_correction: bool,
    /// Declaración del mismo periodo que esta corrige (queda «Reemplazada»).
    pub replaces_id: Option<i64>,
    pub payable_cents: i64,
    pub favor_cents: i64,
    pub nit: String,
    pub company_name: String,
    pub file_name: String,
    pub income_ordinary_cents: Option<i64>,
    pub income_loss_cents: Option<i64>,
    pub advance_next_cents: Option<i64>,
    pub advance_target_year: Option<i64>,
    pub detail: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaxCompanySettings {
    pub company_id: i64,
    pub vat_periodicity: Option<String>,
}

/// «Periodo sin obligación»: el periodo queda cubierto sin declaración ni valores.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaxEmptyPeriod {
    pub id: i64,
    pub company_id: i64,
    pub tax_type: String,
    pub year: i64,
    pub period: Option<i64>,
    pub periodicity: String,
    pub confirmation: String,
    pub status: String,
    pub created_at: String,
    pub voided_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxEmptyPeriodInput {
    pub company_id: i64,
    pub tax_type: String,
    pub year: i64,
    pub period: Option<i64>,
    pub periodicity: String,
    pub confirmation: String,
}

pub fn is_iso_date(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && value.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// Último día del mes (AAAA-MM).
fn month_end(year: i64, month: i64) -> String {
    let days = match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    format!("{year:04}-{month:02}-{days:02}")
}

/// Rango del periodo fiscal: Retefuente mensual, IVA bimestral (1–6) o cuatrimestral (1–3), Renta anual.
pub fn period_range(periodicity: &str, year: i64, period: Option<i64>) -> AppResult<(String, String)> {
    let months = match periodicity {
        "monthly" => 1,
        "bimonthly" => 2,
        "four_monthly" => 4,
        "annual" => return Ok((format!("{year:04}-01-01"), format!("{year:04}-12-31"))),
        _ => return Err(AppError::user("Periodicidad no válida.")),
    };
    let p = period.ok_or_else(|| AppError::user("Falta el periodo de la declaración."))?;
    if p < 1 || p > 12 / months {
        return Err(AppError::user(format!("El periodo {p} no existe para una declaración {}.", match periodicity {
            "monthly" => "mensual",
            "bimonthly" => "bimestral",
            _ => "cuatrimestral",
        })));
    }
    let first = (p - 1) * months + 1;
    Ok((format!("{year:04}-{first:02}-01"), month_end(year, first + months - 1)))
}

impl TaxReturnInput {
    pub fn validated(&self) -> AppResult<TaxReturnInput> {
        if !TAX_TYPES.contains(&self.tax_type.as_str()) {
            return Err(AppError::user("Tipo de impuesto no válido."));
        }
        let expected = match self.tax_type.as_str() {
            "withholding" => self.periodicity == "monthly",
            "vat" => VAT_PERIODICITIES.contains(&self.periodicity.as_str()),
            _ => self.periodicity == "annual",
        };
        if !expected {
            return Err(AppError::user("La periodicidad no corresponde al impuesto."));
        }
        if !(2000..=2100).contains(&self.year) {
            return Err(AppError::user("El año de la declaración no es válido."));
        }
        let period = if self.tax_type == "income" { None } else { self.period };
        let (start, end) = period_range(&self.periodicity, self.year, period)?;
        if self.period_start != start || self.period_end != end {
            return Err(AppError::user("El rango del periodo no corresponde al año y periodo de la declaración."));
        }
        if self.payable_cents < 0 || self.favor_cents < 0 {
            return Err(AppError::user("Los valores de la declaración no pueden ser negativos."));
        }
        let digits = |s: &str| s.chars().filter(|c| c.is_ascii_digit()).collect::<String>();
        let form_number = digits(&self.form_number);
        let previous = digits(&self.previous_form_number);
        if !previous.is_empty() && previous == form_number {
            return Err(AppError::user("El formulario anterior no puede ser el mismo formulario."));
        }
        let income = self.tax_type == "income";
        let non_negative = |v: Option<i64>| v.map_or(true, |n| n >= 0);
        if !non_negative(self.income_ordinary_cents) || !non_negative(self.income_loss_cents) || !non_negative(self.advance_next_cents) {
            return Err(AppError::user("Los valores de la declaración de renta no pueden ser negativos."));
        }
        Ok(TaxReturnInput {
            company_id: self.company_id,
            tax_type: self.tax_type.clone(),
            year: self.year,
            period,
            periodicity: self.periodicity.clone(),
            period_start: start,
            period_end: end,
            form_number,
            previous_form_number: previous,
            is_correction: self.is_correction || !digits(&self.previous_form_number).is_empty() || self.replaces_id.is_some(),
            replaces_id: self.replaces_id,
            payable_cents: self.payable_cents,
            favor_cents: self.favor_cents,
            nit: digits(self.nit.split('-').next().unwrap_or("")),
            company_name: clean(&self.company_name, 300),
            file_name: clean(&self.file_name, 300),
            income_ordinary_cents: if income { self.income_ordinary_cents } else { None },
            income_loss_cents: if income { self.income_loss_cents } else { None },
            advance_next_cents: if income { self.advance_next_cents } else { None },
            // El anticipo siempre es para el año siguiente al declarado.
            advance_target_year: if income { Some(self.year + 1) } else { None },
            detail: self.detail.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn period_ranges_by_periodicity() {
        assert_eq!(period_range("monthly", 2026, Some(9)).unwrap(), ("2026-09-01".into(), "2026-09-30".into()));
        assert_eq!(period_range("bimonthly", 2026, Some(4)).unwrap(), ("2026-07-01".into(), "2026-08-31".into()));
        assert_eq!(period_range("bimonthly", 2024, Some(1)).unwrap().1, "2024-02-29");
        assert_eq!(period_range("four_monthly", 2026, Some(2)).unwrap(), ("2026-05-01".into(), "2026-08-31".into()));
        assert_eq!(period_range("annual", 2025, None).unwrap(), ("2025-01-01".into(), "2025-12-31".into()));
        assert!(period_range("four_monthly", 2026, Some(4)).is_err());
        assert!(period_range("bimonthly", 2026, None).is_err());
    }

    #[test]
    fn advance_target_year_is_always_the_next_year() {
        let input = TaxReturnInput {
            company_id: 1,
            tax_type: "income".into(),
            year: 2024,
            periodicity: "annual".into(),
            period_start: "2024-01-01".into(),
            period_end: "2024-12-31".into(),
            advance_next_cents: Some(74_800_000),
            advance_target_year: Some(1999),
            ..Default::default()
        };
        assert_eq!(input.validated().unwrap().advance_target_year, Some(2025));
    }
}
