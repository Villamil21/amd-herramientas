use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::normalize;
use crate::models::self_withholding::validate_ciiu;
use crate::models::third_party::ThirdPartyData;

pub const DOCUMENT_KINDS: [&str; 2] = ["rut", "camara"];
pub const ROLE_PRINCIPAL: &str = "principal";
pub const ROLE_ALTERNATE: &str = "alternate";
/// Estado del RUT de un socio: sin importar, confirmado por el usuario, o con diferencias por resolver.
pub const RUT_STATUSES: [&str; 3] = ["pendiente", "validado", "revisar"];

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
    /// Representante legal principal (firma los Estados Financieros). Vacío = sin configurar; ausente en backups anteriores.
    #[serde(default)]
    pub legal_rep_name: String,
    #[serde(default)]
    pub legal_rep_document: String,
    /// Representante legal suplente (opcional). Nunca reemplaza al principal.
    #[serde(default)]
    pub legal_rep_alt_name: String,
    #[serde(default)]
    pub legal_rep_alt_document: String,
    /// El principal / suplente no está entre los socios y el usuario lo confirmó como excepción.
    #[serde(default)]
    pub legal_rep_manual: bool,
    #[serde(default)]
    pub legal_rep_alt_manual: bool,
    /// Datos registrales de la Cámara de Comercio (siempre editables). Ausentes en backups anteriores.
    #[serde(default)]
    pub entity_narrative: String,
    #[serde(default)]
    pub corporate_purpose: String,
    #[serde(default)]
    pub registry_chamber: String,
    #[serde(default)]
    pub registry_city: String,
    #[serde(default)]
    pub constitution_doc_type: String,
    /// AAAA-MM-DD o vacío.
    #[serde(default)]
    pub constitution_date: String,
    #[serde(default)]
    pub registry_number: String,
    #[serde(default)]
    pub registry_date: String,
    #[serde(default)]
    pub registry_book: String,
    /// Campos registrales que la lectura del certificado no confirmó con certeza («Revisar»).
    #[serde(default)]
    pub registral_review: Vec<String>,
    #[serde(default)]
    pub shareholders: Vec<Shareholder>,
    /// Historial de RUT / Cámara de Comercio (más antiguo primero). Se llena al leer; no se restaura desde el backup.
    #[serde(default)]
    pub documents: Vec<CompanyDocument>,
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
    /// «principal» / «alternate» si este socio es el representante legal. Ausente en backups anteriores.
    #[serde(default)]
    pub legal_role: Option<String>,
    /// Identificación, ubicación y tipo de persona del socio (alimentan el formato 1010 de Exógena).
    #[serde(flatten)]
    pub tax: ThirdPartyData,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub email: String,
    /// «pendiente», «validado» o «revisar».
    #[serde(default = "default_rut_status")]
    pub rut_status: String,
    /// Historial del RUT del socio (más antiguo primero). Se llena al leer; no viaja en el backup.
    #[serde(default)]
    pub documents: Vec<CompanyDocument>,
    /// RUT cargado en el formulario (ya copiado al almacenamiento) que se registra al guardar la empresa.
    #[serde(default)]
    pub new_documents: Vec<NewDocument>,
}

fn default_rut_status() -> String {
    "pendiente".to_string()
}

#[cfg(test)]
impl Shareholder {
    /// Socio con solo los datos mínimos (los demás en blanco / pendientes).
    pub fn basic(name: &str, identity_document: &str, percentage: f64, legal_role: Option<&str>) -> Self {
        Shareholder {
            id: None,
            name: name.into(),
            identity_document: identity_document.into(),
            percentage,
            sort_order: 0,
            legal_role: legal_role.map(str::to_string),
            tax: ThirdPartyData::default(),
            phone: String::new(),
            email: String::new(),
            rut_status: default_rut_status(),
            documents: Vec::new(),
            new_documents: Vec::new(),
        }
    }
}

/// Una versión del RUT o de la Cámara de Comercio guardada en el almacenamiento de la app.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanyDocument {
    pub id: i64,
    pub kind: String,
    pub file_name: String,
    pub stored_file: String,
    pub size_bytes: i64,
    pub uploaded_at: String,
    /// La versión más reciente de su tipo.
    #[serde(default)]
    pub is_current: bool,
}

/// Documento cargado en el formulario (ya copiado al almacenamiento) que se registra al guardar.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewDocument {
    pub kind: String,
    pub file_name: String,
    pub stored_file: String,
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
    pub legal_rep_name: String,
    #[serde(default)]
    pub legal_rep_document: String,
    #[serde(default)]
    pub legal_rep_alt_name: String,
    #[serde(default)]
    pub legal_rep_alt_document: String,
    #[serde(default)]
    pub legal_rep_manual: bool,
    #[serde(default)]
    pub legal_rep_alt_manual: bool,
    /// Datos registrales de la Cámara de Comercio (siempre editables). Ausentes en backups anteriores.
    #[serde(default)]
    pub entity_narrative: String,
    #[serde(default)]
    pub corporate_purpose: String,
    #[serde(default)]
    pub registry_chamber: String,
    #[serde(default)]
    pub registry_city: String,
    #[serde(default)]
    pub constitution_doc_type: String,
    /// AAAA-MM-DD o vacío.
    #[serde(default)]
    pub constitution_date: String,
    #[serde(default)]
    pub registry_number: String,
    #[serde(default)]
    pub registry_date: String,
    #[serde(default)]
    pub registry_book: String,
    /// Campos registrales que la lectura del certificado no confirmó con certeza («Revisar»).
    #[serde(default)]
    pub registral_review: Vec<String>,
    #[serde(default)]
    pub shareholders: Vec<Shareholder>,
    /// Versiones nuevas del RUT / Cámara cargadas en esta edición.
    #[serde(default)]
    pub new_documents: Vec<NewDocument>,
    /// Tamaño real de cada archivo nuevo (empresa y socios), que llena el comando antes de guardar.
    #[serde(skip)]
    pub document_sizes: std::collections::HashMap<String, i64>,
}

/// Normaliza a un socio: textos en mayúsculas, documento sin separadores, datos tributarios y contacto.
fn normalize_shareholder(s: Shareholder, index: usize) -> AppResult<Shareholder> {
    let tax = s.tax.normalized()?.without_inapplicable_names();
    let mut name = normalize::upper_text(&s.name, 200);
    if name.is_empty() && tax.person_type.as_deref() == Some("PN") {
        // Persona natural: el nombre completo se arma con sus partes (apellidos primero, como en el RUT).
        name = normalize::upper_text(&[tax.first_surname.as_str(), tax.second_surname.as_str(), tax.first_name.as_str(), tax.other_names.as_str()].join(" "), 200);
    }
    let email = s.email.trim().to_lowercase().chars().take(150).collect::<String>();
    if !email.is_empty() && !(email.contains('@') && email.contains('.')) {
        return Err(AppError::user(format!("El correo electrónico del socio «{name}» no es válido.")));
    }
    if !RUT_STATUSES.contains(&s.rut_status.as_str()) {
        return Err(AppError::user("El estado del RUT del socio no es válido."));
    }
    for d in &s.new_documents {
        if d.kind != "rut" {
            return Err(AppError::user("El documento de un socio debe ser su RUT."));
        }
    }
    Ok(Shareholder {
        id: s.id,
        name,
        identity_document: normalize::document(&s.identity_document, 60),
        percentage: s.percentage,
        sort_order: index as i64,
        legal_role: s.legal_role.filter(|r| !r.trim().is_empty()),
        tax,
        phone: normalize::phone(&s.phone, 60),
        email,
        rut_status: s.rut_status,
        documents: Vec::new(),
        new_documents: s.new_documents,
    })
}

/// Tolerancia decimal para que los porcentajes sumen 100 (p. ej. 33,33 + 33,33 + 33,34).
const PERCENT_TOLERANCE: f64 = 1e-6;

/// Suma de porcentajes en milésimas de punto (evita acumular errores de coma flotante).
fn total_milli_percent(list: &[Shareholder]) -> i64 {
    list.iter().map(|s| (s.percentage * 1000.0).round() as i64).sum()
}

impl CompanyInput {
    /// Valida y normaliza en Rust aunque React ya lo haya hecho: el backend es la última barrera
    /// (guardado, restauración de respaldos y llamadas internas pasan por aquí).
    pub fn validated(self) -> AppResult<Self> {
        let (nit, dv) = normalize::nit_and_dv(&self.nit, &self.dv).map_err(AppError::user)?;
        let mut v = CompanyInput {
            razon_social: normalize::upper_text(&self.razon_social, 200),
            nit: nit.chars().take(30).collect(),
            direccion: normalize::upper_text(&self.direccion, 250),
            ciudad: normalize::upper_text(&self.ciudad, 100),
            telefono: normalize::phone(&self.telefono, 60),
            correo: self.correo.trim().to_lowercase().chars().take(150).collect(),
            info_adicional: normalize::upper_text(&self.info_adicional, 2000),
            logo_file: self.logo_file.filter(|s| !s.trim().is_empty()),
            dv: dv.chars().take(2).collect(),
            subscribed_total_shares: self.subscribed_total_shares,
            subscribed_nominal_value: self.subscribed_nominal_value,
            paid_total_shares: self.paid_total_shares,
            paid_nominal_value: self.paid_nominal_value,
            ciiu_code: validate_ciiu(&self.ciiu_code)?,
            legal_rep_name: normalize::upper_text(&self.legal_rep_name, 200),
            legal_rep_document: normalize::document(&self.legal_rep_document, 60),
            legal_rep_alt_name: normalize::upper_text(&self.legal_rep_alt_name, 200),
            legal_rep_alt_document: normalize::document(&self.legal_rep_alt_document, 60),
            legal_rep_manual: self.legal_rep_manual,
            legal_rep_alt_manual: self.legal_rep_alt_manual,
            entity_narrative: normalize::free_text(&self.entity_narrative, 4000),
            corporate_purpose: normalize::free_text(&self.corporate_purpose, 8000),
            registry_chamber: normalize::free_text(&self.registry_chamber, 150),
            registry_city: normalize::free_text(&self.registry_city, 100),
            constitution_doc_type: normalize::free_text(&self.constitution_doc_type, 100),
            constitution_date: normalize::iso_date_or_empty(&self.constitution_date, "La fecha de constitución")?,
            registry_number: normalize::free_text(&self.registry_number, 60),
            registry_date: normalize::iso_date_or_empty(&self.registry_date, "La fecha de matrícula o inscripción")?,
            registry_book: normalize::free_text(&self.registry_book, 60),
            registral_review: self.registral_review.iter().map(|k| k.trim().to_string()).filter(|k| !k.is_empty()).take(20).collect(),
            shareholders: Vec::new(),
            new_documents: self.new_documents,
            document_sizes: self.document_sizes,
        };
        for (i, s) in self.shareholders.into_iter().enumerate() {
            v.shareholders.push(normalize_shareholder(s, i)?);
        }
        if v.razon_social.is_empty() {
            return Err(AppError::user("La razón social es obligatoria."));
        }
        if v.nit.is_empty() {
            return Err(AppError::user("El NIT es obligatorio."));
        }
        if !v.nit.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::user("El NIT solo puede contener números (sin puntos, espacios ni guion); el DV va en su propio campo."));
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
        v.validate_shareholders()?;
        v.resolve_legal_representatives()?;
        for d in &v.new_documents {
            if !DOCUMENT_KINDS.contains(&d.kind.as_str()) {
                return Err(AppError::user("El tipo de documento debe ser RUT o Cámara de Comercio."));
            }
        }
        Ok(v)
    }

    fn validate_shareholders(&self) -> AppResult<()> {
        for s in &self.shareholders {
            if s.name.is_empty() || s.identity_document.is_empty() || !s.percentage.is_finite() || s.percentage <= 0.0 || s.percentage > 100.0 {
                return Err(AppError::user("Cada accionista debe tener nombre, documento y porcentaje válido."));
            }
            // El porcentaje admite hasta dos decimales (50,20 %): más precisión no cabe en el formato 1010.
            if ((s.percentage * 100.0) - (s.percentage * 100.0).round()).abs() > 1e-6 {
                return Err(AppError::user(format!("La participación de «{}» admite hasta dos decimales.", s.name)));
            }
            if let Some(role) = &s.legal_role {
                if role != ROLE_PRINCIPAL && role != ROLE_ALTERNATE {
                    return Err(AppError::user("El rol de representación legal de un socio no es válido."));
                }
            }
        }
        let mut seen = std::collections::HashSet::new();
        for s in &self.shareholders {
            let key = normalize::digits(&s.identity_document);
            if !key.is_empty() && !seen.insert(key) {
                return Err(AppError::user(format!("El documento de «{}» está repetido entre los accionistas.", s.name)));
            }
        }
        if !self.shareholders.is_empty() {
            let total = total_milli_percent(&self.shareholders) as f64 / 1000.0;
            if (total - 100.0).abs() > PERCENT_TOLERANCE.max(0.0005) {
                return Err(AppError::user(format!("La participación de los accionistas debe sumar exactamente 100 % (hoy suma {total} %).")));
            }
        }
        Ok(())
    }

    /// Principal y suplente salen de los socios; sin socio vinculado solo se aceptan como excepción confirmada.
    fn resolve_legal_representatives(&mut self) -> AppResult<()> {
        let principal = self.shareholders.iter().filter(|s| s.legal_role.as_deref() == Some(ROLE_PRINCIPAL)).count();
        let alternate = self.shareholders.iter().filter(|s| s.legal_role.as_deref() == Some(ROLE_ALTERNATE)).count();
        if principal > 1 || alternate > 1 {
            return Err(AppError::user("Solo puede haber un representante legal principal y un suplente entre los socios."));
        }
        for (role, label, manual) in [(ROLE_PRINCIPAL, "principal", self.legal_rep_manual), (ROLE_ALTERNATE, "suplente", self.legal_rep_alt_manual)] {
            let linked = self.shareholders.iter().find(|s| s.legal_role.as_deref() == Some(role)).map(|s| (s.name.clone(), s.identity_document.clone()));
            let (name, document) = match (&linked, role) {
                (Some(l), _) => l.clone(),
                (None, ROLE_PRINCIPAL) => (self.legal_rep_name.clone(), self.legal_rep_document.clone()),
                _ => (self.legal_rep_alt_name.clone(), self.legal_rep_alt_document.clone()),
            };
            let manual = manual && linked.is_none();
            if linked.is_none() {
                let empty = name.is_empty() && document.is_empty();
                if !empty && !manual {
                    return Err(AppError::user(format!("El representante legal {label} debe seleccionarse entre los socios. Si no está entre ellos, confirma la excepción.")));
                }
                if !empty && (name.is_empty() || document.is_empty()) {
                    return Err(AppError::user(format!("El representante legal {label} necesita nombre y documento.")));
                }
            }
            match role {
                ROLE_PRINCIPAL => {
                    self.legal_rep_name = name;
                    self.legal_rep_document = document;
                    self.legal_rep_manual = manual;
                }
                _ => {
                    self.legal_rep_alt_name = name;
                    self.legal_rep_alt_document = document;
                    self.legal_rep_alt_manual = manual;
                }
            }
        }
        if (!self.legal_rep_alt_name.is_empty() || !self.legal_rep_alt_document.is_empty()) && self.legal_rep_name.is_empty() {
            return Err(AppError::user("Define primero el representante legal principal; el suplente no lo reemplaza."));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shareholder(name: &str, doc: &str, pct: f64, role: Option<&str>) -> Shareholder {
        Shareholder::basic(name, doc, pct, role)
    }

    fn input() -> CompanyInput {
        CompanyInput {
            razon_social: " mi empresa  s.a.s ".into(),
            nit: "900.123.456".into(),
            direccion: "cl 10 # 5-20".into(),
            ciudad: "cali".into(),
            telefono: "+57 300 123 4567".into(),
            correo: " Info@Empresa.CO ".into(),
            info_adicional: String::new(),
            logo_file: None,
            dv: "7".into(),
            subscribed_total_shares: Some(1000),
            subscribed_nominal_value: Some(1000),
            paid_total_shares: None,
            paid_nominal_value: None,
            ciiu_code: String::new(),
            legal_rep_name: String::new(),
            legal_rep_document: String::new(),
            legal_rep_alt_name: String::new(),
            legal_rep_alt_document: String::new(),
            legal_rep_manual: false,
            legal_rep_alt_manual: false,
            entity_narrative: String::new(),
            corporate_purpose: String::new(),
            registry_chamber: String::new(),
            registry_city: String::new(),
            constitution_doc_type: String::new(),
            constitution_date: String::new(),
            registry_number: String::new(),
            registry_date: String::new(),
            registry_book: String::new(),
            registral_review: vec![],
            shareholders: vec![],
            new_documents: vec![],
            document_sizes: Default::default(),
        }
    }

    #[test]
    fn normalizes_text_numbers_and_email() {
        let v = input().validated().unwrap();
        assert_eq!(v.razon_social, "MI EMPRESA S.A.S");
        assert_eq!(v.nit, "900123456");
        assert_eq!(v.dv, "7");
        assert_eq!(v.ciudad, "CALI");
        assert_eq!(v.direccion, "CL 10 # 5-20");
        assert_eq!(v.telefono, "+573001234567");
        assert_eq!(v.correo, "info@empresa.co");
    }

    #[test]
    fn nit_with_inline_dv_is_split_and_non_digits_are_rejected() {
        let mut i = input();
        i.nit = "900.123.456-7".into();
        i.dv = String::new();
        let v = i.validated().unwrap();
        assert_eq!((v.nit.as_str(), v.dv.as_str()), ("900123456", "7"));
        let mut bad = input();
        bad.nit = "900ABC".into();
        assert!(bad.validated().is_err());
    }

    #[test]
    fn shareholders_must_sum_exactly_100() {
        let mut i = input();
        i.shareholders = vec![shareholder("a", "cc 1.000", 60.0, None), shareholder("b", "cc 2.000", 30.0, None)];
        assert!(i.clone().validated().is_err());
        i.shareholders[1].percentage = 40.0;
        let v = i.clone().validated().unwrap();
        assert_eq!(v.shareholders[0].name, "A");
        assert_eq!(v.shareholders[0].identity_document, "CC 1000");
        // Decimales seguros.
        i.shareholders = vec![shareholder("a", "1", 33.33, None), shareholder("b", "2", 33.33, None), shareholder("c", "3", 33.34, None)];
        assert!(i.clone().validated().is_ok());
        // Un solo socio debe tener el 100 %.
        i.shareholders = vec![shareholder("a", "1", 99.0, None)];
        assert!(i.clone().validated().is_err());
        i.shareholders = vec![shareholder("a", "1", 100.0, None)];
        assert!(i.validated().is_ok());
    }

    #[test]
    fn repeated_shareholder_documents_are_rejected() {
        let mut i = input();
        i.shareholders = vec![shareholder("a", "CC 1.000", 50.0, None), shareholder("b", "1000", 50.0, None)];
        assert!(i.validated().is_err());
    }

    #[test]
    fn legal_rep_comes_from_the_linked_shareholder() {
        let mut i = input();
        i.shareholders = vec![shareholder("ana gómez", "cc 1.020", 50.0, Some(ROLE_PRINCIPAL)), shareholder("luis ruiz", "cc 2.030", 50.0, Some(ROLE_ALTERNATE))];
        // Datos escritos a mano se descartan a favor del socio vinculado.
        i.legal_rep_name = "otro nombre".into();
        let v = i.validated().unwrap();
        assert_eq!((v.legal_rep_name.as_str(), v.legal_rep_document.as_str()), ("ANA GÓMEZ", "CC 1020"));
        assert_eq!((v.legal_rep_alt_name.as_str(), v.legal_rep_alt_document.as_str()), ("LUIS RUIZ", "CC 2030"));
        assert!(!v.legal_rep_manual && !v.legal_rep_alt_manual);
    }

    #[test]
    fn legal_rep_outside_shareholders_needs_explicit_exception() {
        let mut i = input();
        i.shareholders = vec![shareholder("ana", "1", 100.0, None)];
        i.legal_rep_name = "pedro".into();
        i.legal_rep_document = "cc 9".into();
        assert!(i.clone().validated().is_err());
        i.legal_rep_manual = true;
        let v = i.clone().validated().unwrap();
        assert!(v.legal_rep_manual);
        assert_eq!(v.legal_rep_name, "PEDRO");
        // El suplente no reemplaza al principal.
        let mut alt_only = input();
        alt_only.shareholders = vec![shareholder("ana", "1", 100.0, Some(ROLE_ALTERNATE))];
        assert!(alt_only.validated().is_err());
    }

    #[test]
    fn two_principals_are_rejected() {
        let mut i = input();
        i.shareholders = vec![shareholder("a", "1", 50.0, Some(ROLE_PRINCIPAL)), shareholder("b", "2", 50.0, Some(ROLE_PRINCIPAL))];
        assert!(i.validated().is_err());
    }
}
