//! Datos tributarios y territoriales de un tercero para Información Exógena. Los comparten proveedores y socios:
//! las mismas reglas de normalización y de «completo / requiere datos» en un solo lugar.
//!
//! El frontend tiene la misma lógica (`src/modules/exogena/domain/thirdParty.ts`) con los mismos casos de prueba.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::normalize;

/// Código DIAN de Colombia: solo entonces se exigen departamento y municipio.
pub const COLOMBIA: &str = "169";
/// NIT.
pub const DOC_NIT: &str = "31";
/// Tipos de documento cuyo número puede llevar letras (pasaportes y documentos extranjeros).
const ALPHANUMERIC_DOC_TYPES: [&str; 7] = ["33", "41", "42", "43", "44", "46", "47"];

pub const STATUS_COMPLETE: &str = "completo";
pub const STATUS_MISSING: &str = "requiere_datos";

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ThirdPartyData {
    /// Código DIAN del tipo de documento («13», «31»…). `None` = sin definir (nunca se inventa).
    pub doc_type_code: Option<String>,
    /// Solo para NIT.
    pub dv: String,
    /// «PJ» o «PN».
    pub person_type: Option<String>,
    pub first_surname: String,
    pub second_surname: String,
    pub first_name: String,
    pub other_names: String,
    pub address: String,
    pub country_code: String,
    pub country_name: String,
    pub dept_code: String,
    pub dept_name: String,
    pub muni_code: String,
    pub muni_name: String,
}

/// El número de este tipo de documento admite letras (pasaportes y documentos extranjeros).
pub fn allows_letters(doc_type: Option<&str>) -> bool {
    doc_type.is_some_and(|t| ALPHANUMERIC_DOC_TYPES.contains(&t))
}

/// Número de documento sin espacios, puntos ni guiones. Numérico para CC/NIT/CE…; alfanumérico en mayúsculas para pasaportes.
pub fn document_number(value: &str, doc_type: Option<&str>) -> String {
    let main = if doc_type == Some(DOC_NIT) { value.split('-').next().unwrap_or("") } else { value };
    if allows_letters(doc_type) {
        main.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_uppercase()
    } else {
        main.chars().filter(char::is_ascii_digit).collect()
    }
}

/// Un código que son solo dígitos conserva sus ceros iniciales: «5» → «05» (departamento), «1» → «001» (municipio).
fn code(value: &str, width: usize) -> AppResult<String> {
    let v = value.trim();
    if v.is_empty() {
        return Ok(String::new());
    }
    if !v.chars().all(|c| c.is_ascii_digit()) || v.len() > width {
        return Err(AppError::user(format!("El código «{v}» no es válido: debe tener {width} dígitos.")));
    }
    Ok(format!("{v:0>width$}"))
}

impl ThirdPartyData {
    /// Recorta, pasa a mayúsculas y valida el formato (no consulta catálogos: eso lo hace `database::exogena`).
    pub fn normalized(mut self) -> AppResult<Self> {
        self.doc_type_code = self.doc_type_code.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
        if let Some(c) = &self.doc_type_code {
            if c.len() != 2 || !c.chars().all(|ch| ch.is_ascii_digit()) {
                return Err(AppError::user("El tipo de documento debe ser un código DIAN de dos dígitos (por ejemplo 13 o 31)."));
            }
        }
        self.dv = normalize::digits(&self.dv).chars().take(1).collect();
        self.person_type = match self.person_type.as_deref().map(|t| t.trim().to_ascii_uppercase()).filter(|t| !t.is_empty()) {
            None => None,
            Some(t) if t == "PJ" || t == "PN" => Some(t),
            Some(_) => return Err(AppError::user("El tipo de persona debe ser natural o jurídica.")),
        };
        self.first_surname = normalize::upper_text(&self.first_surname, 60);
        self.second_surname = normalize::upper_text(&self.second_surname, 60);
        self.first_name = normalize::upper_text(&self.first_name, 60);
        self.other_names = normalize::upper_text(&self.other_names, 60);
        self.address = normalize::upper_text(&self.address, 250);
        self.country_code = code(&self.country_code, 3)?;
        self.dept_code = code(&self.dept_code, 2)?;
        self.muni_code = code(&self.muni_code, 3)?;
        if self.doc_type_code.as_deref() != Some(DOC_NIT) {
            self.dv.clear();
        }
        Ok(self)
    }

    /// Un PN no lleva razón social en Exógena y un PJ no lleva nombres: se limpian los campos que no aplican.
    pub fn without_inapplicable_names(mut self) -> Self {
        if self.person_type.as_deref() == Some("PJ") {
            self.first_surname.clear();
            self.second_surname.clear();
            self.first_name.clear();
            self.other_names.clear();
        }
        self
    }

    /// Qué falta para poder reportar al tercero en Exógena (vacío = completo).
    /// `number` es el documento ya normalizado y `legal_name` la razón social (PJ).
    pub fn missing_fields(&self, number: &str, legal_name: &str) -> Vec<&'static str> {
        let mut missing = Vec::new();
        if self.doc_type_code.is_none() {
            missing.push("Tipo de documento");
        }
        if number.is_empty() {
            missing.push("Número de documento");
        }
        if self.doc_type_code.as_deref() == Some(DOC_NIT) && self.dv.is_empty() {
            missing.push("DV");
        }
        match self.person_type.as_deref() {
            None => missing.push("Persona natural o jurídica"),
            Some("PJ") => {
                if legal_name.trim().is_empty() {
                    missing.push("Razón social");
                }
            }
            Some(_) => {
                if self.first_surname.is_empty() {
                    missing.push("Primer apellido");
                }
                if self.first_name.is_empty() {
                    missing.push("Primer nombre");
                }
            }
        }
        if self.address.is_empty() {
            missing.push("Dirección");
        }
        if self.country_code.is_empty() {
            missing.push("País");
        } else if self.country_code == COLOMBIA {
            if self.dept_code.is_empty() {
                missing.push("Departamento");
            }
            if self.muni_code.is_empty() {
                missing.push("Municipio");
            }
        }
        missing
    }

    pub fn status(&self, number: &str, legal_name: &str) -> &'static str {
        if self.missing_fields(number, legal_name).is_empty() {
            STATUS_COMPLETE
        } else {
            STATUS_MISSING
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete_pj() -> ThirdPartyData {
        ThirdPartyData {
            doc_type_code: Some("31".into()),
            dv: "9".into(),
            person_type: Some("PJ".into()),
            address: "CL 77B 57 103".into(),
            country_code: "169".into(),
            dept_code: "08".into(),
            muni_code: "001".into(),
            ..Default::default()
        }
    }

    #[test]
    fn document_numbers_drop_separators_and_keep_letters_only_where_allowed() {
        assert_eq!(document_number("901.741.186-9", Some("31")), "901741186");
        assert_eq!(document_number("1.192.816.998", Some("13")), "1192816998");
        assert_eq!(document_number(" ab-123 456 ", Some("41")), "AB123456");
        assert_eq!(document_number("CC 1020", Some("13")), "1020");
        assert_eq!(document_number("9 0 0", None), "900");
    }

    #[test]
    fn territory_codes_keep_leading_zeros() {
        let d = ThirdPartyData { country_code: "169".into(), dept_code: "76".into(), muni_code: "001".into(), ..Default::default() }.normalized().unwrap();
        assert_eq!((d.country_code.as_str(), d.dept_code.as_str(), d.muni_code.as_str()), ("169", "76", "001"));
        // Un código que perdió sus ceros al pasar por un número se repara, no se interpreta como otro.
        let d = ThirdPartyData { country_code: "169".into(), dept_code: "5".into(), muni_code: "1".into(), ..Default::default() }.normalized().unwrap();
        assert_eq!((d.dept_code.as_str(), d.muni_code.as_str()), ("05", "001"));
        assert!(ThirdPartyData { dept_code: "123".into(), ..Default::default() }.normalized().is_err());
        assert!(ThirdPartyData { muni_code: "A01".into(), ..Default::default() }.normalized().is_err());
    }

    #[test]
    fn normalization_uppercases_and_clears_dv_unless_nit() {
        let d = ThirdPartyData {
            doc_type_code: Some("13".into()),
            dv: "7".into(),
            person_type: Some(" pn ".into()),
            first_surname: "  angarita ".into(),
            first_name: "ronaldo".into(),
            address: "cl 77 b # 57-103".into(),
            ..Default::default()
        }
        .normalized()
        .unwrap();
        assert_eq!((d.first_surname.as_str(), d.first_name.as_str(), d.person_type.as_deref(), d.dv.as_str()), ("ANGARITA", "RONALDO", Some("PN"), ""));
        assert_eq!(d.address, "CL 77 B # 57-103");
        assert!(ThirdPartyData { doc_type_code: Some("1".into()), ..Default::default() }.normalized().is_err());
        assert!(ThirdPartyData { person_type: Some("XX".into()), ..Default::default() }.normalized().is_err());
    }

    #[test]
    fn pj_needs_legal_name_and_nit_needs_dv() {
        let d = complete_pj();
        assert_eq!(d.status("901741186", "GLOWING DIGITAL CLOUD S.A.S."), STATUS_COMPLETE);
        assert_eq!(d.missing_fields("901741186", ""), vec!["Razón social"]);
        let no_dv = ThirdPartyData { dv: String::new(), ..d.clone() };
        assert_eq!(no_dv.missing_fields("901741186", "X"), vec!["DV"]);
    }

    #[test]
    fn pn_needs_surname_and_name_and_never_a_legal_name() {
        let pn = ThirdPartyData {
            doc_type_code: Some("13".into()),
            person_type: Some("PN".into()),
            address: "CALLE 1".into(),
            country_code: "169".into(),
            dept_code: "76".into(),
            muni_code: "001".into(),
            ..Default::default()
        };
        assert_eq!(pn.missing_fields("1192816998", "ANGARITA LOPEZ RONALDO"), vec!["Primer apellido", "Primer nombre"]);
        let ok = ThirdPartyData { first_surname: "ANGARITA".into(), first_name: "RONALDO".into(), ..pn };
        assert_eq!(ok.status("1192816998", "cualquiera"), STATUS_COMPLETE);
    }

    #[test]
    fn unknown_document_type_or_person_type_requires_data_and_is_never_invented() {
        let d = ThirdPartyData { address: "X".into(), country_code: "169".into(), dept_code: "76".into(), muni_code: "001".into(), ..Default::default() };
        let missing = d.missing_fields("1192816998", "ANGARITA");
        assert!(missing.contains(&"Tipo de documento") && missing.contains(&"Persona natural o jurídica"));
    }

    #[test]
    fn foreign_countries_do_not_need_department_or_municipality() {
        let d = ThirdPartyData { country_code: "249".into(), ..complete_pj() };
        assert!(d.missing_fields("901741186", "X").is_empty());
        let colombia_without_city = ThirdPartyData { dept_code: String::new(), muni_code: String::new(), ..complete_pj() };
        assert_eq!(colombia_without_city.missing_fields("901741186", "X"), vec!["Departamento", "Municipio"]);
    }

    #[test]
    fn pj_clears_person_names() {
        let d = ThirdPartyData { person_type: Some("PJ".into()), first_name: "X".into(), first_surname: "Y".into(), ..Default::default() }.without_inapplicable_names();
        assert!(d.first_name.is_empty() && d.first_surname.is_empty());
    }
}
