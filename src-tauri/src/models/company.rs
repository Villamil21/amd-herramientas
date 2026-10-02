use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;
use crate::models::self_withholding::validate_ciiu;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub id: i64,
    pub razon_social: String,
    pub nit: String,
    pub direccion: String,
    pub ciudad: String,
    pub telefono: String,
    pub correo: String,
    pub info_adicional: String,
    pub logo_file: Option<String>,
    pub dv: String,
    pub subscribed_total_shares: Option<i64>,
    pub subscribed_nominal_value: Option<i64>,
    pub paid_total_shares: Option<i64>,
    pub paid_nominal_value: Option<i64>,
    /// Código CIIU como texto (conserva ceros iniciales). Vacío = sin configurar; ausente en backups anteriores.
    #[serde(default)]
    pub ciiu_code: String,
    #[serde(default)]
    pub shareholders: Vec<Shareholder>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Shareholder {
    pub id: Option<i64>,
    pub name: String,
    pub identity_document: String,
    pub percentage: f64,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanyInput {
    pub razon_social: String,
    pub nit: String,
    #[serde(default)]
    pub direccion: String,
    #[serde(default)]
    pub ciudad: String,
    #[serde(default)]
    pub telefono: String,
    #[serde(default)]
    pub correo: String,
    #[serde(default)]
    pub info_adicional: String,
    pub logo_file: Option<String>,
    #[serde(default)]
    pub dv: String,
    pub subscribed_total_shares: Option<i64>,
    pub subscribed_nominal_value: Option<i64>,
    pub paid_total_shares: Option<i64>,
    pub paid_nominal_value: Option<i64>,
    #[serde(default)]
    pub ciiu_code: String,
    #[serde(default)]
    pub shareholders: Vec<Shareholder>,
}

impl CompanyInput {
    /// Valida en Rust aunque React ya haya validado: el backend es la última barrera.
    pub fn validated(self) -> AppResult<Self> {
        let v = CompanyInput {
            razon_social: clean(&self.razon_social, 200),
            nit: clean(&self.nit, 30),
            direccion: clean(&self.direccion, 250),
            ciudad: clean(&self.ciudad, 100),
            telefono: clean(&self.telefono, 60),
            correo: clean(&self.correo, 150),
            info_adicional: clean(&self.info_adicional, 2000),
            logo_file: self.logo_file.filter(|s| !s.trim().is_empty()),
            dv: clean(&self.dv, 2),
            subscribed_total_shares: self.subscribed_total_shares,
            subscribed_nominal_value: self.subscribed_nominal_value,
            paid_total_shares: self.paid_total_shares,
            paid_nominal_value: self.paid_nominal_value,
            ciiu_code: validate_ciiu(&self.ciiu_code)?,
            shareholders: self.shareholders.into_iter().enumerate().map(|(i, s)| Shareholder {
                id: s.id,
                name: clean(&s.name, 200),
                identity_document: clean(&s.identity_document, 60),
                percentage: s.percentage,
                sort_order: i as i64,
            }).collect(),
        };
        if v.razon_social.is_empty() {
            return Err(AppError::user("La razón social es obligatoria."));
        }
        if v.nit.is_empty() {
            return Err(AppError::user("El NIT es obligatorio."));
        }
        if !v.nit.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | ' ')) {
            return Err(AppError::user("El NIT solo puede contener números, puntos y guion."));
        }
        if !v.correo.is_empty() && !(v.correo.contains('@') && v.correo.contains('.')) {
            return Err(AppError::user("El correo electrónico no es válido."));
        }
        if !v.dv.is_empty() && !v.dv.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::user("El DV solo puede contener números."));
        }
        for (shares, nominal, label) in [
            (v.subscribed_total_shares, v.subscribed_nominal_value, "Capital suscrito"),
            (v.paid_total_shares, v.paid_nominal_value, "Capital pagado"),
        ] {
            if shares.is_some() != nominal.is_some() || shares.is_some_and(|x| x <= 0) || nominal.is_some_and(|x| x <= 0) {
                return Err(AppError::user(format!("{label}: ingresa acciones y valor nominal positivos.")));
            }
        }
        for s in &v.shareholders {
            if s.name.is_empty() || s.identity_document.is_empty() || !s.percentage.is_finite() || s.percentage <= 0.0 || s.percentage > 100.0 {
                return Err(AppError::user("Cada accionista debe tener nombre, documento y porcentaje válido."));
            }
        }
        Ok(v)
    }
}
