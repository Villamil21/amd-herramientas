//! Normalización de datos de empresas, representantes y accionistas.
//!
//! Las mismas reglas existen en el frontend (`src/pages/companies/normalize.ts`)
//! con los mismos casos de prueba; aquí son la barrera definitiva (guardado,
//! restauración de respaldos y llamadas internas).

const SEPARATORS: [char; 5] = [' ', '.', ',', '-', '\u{a0}'];

/// Recorta, colapsa espacios y pasa a MAYÚSCULAS (con tildes y ñ).
pub fn upper_text(value: &str, max: usize) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").to_uppercase().chars().take(max).collect()
}

/// Quita espacios y separadores visuales (. , - espacio) que estén entre dos dígitos.
/// «CC 1.192.729.629» → «CC 1192729629»; «3 10-555 1234» → «3105551234».
pub fn strip_digit_separators(value: &str) -> String {
    let chars: Vec<char> = value.trim().chars().collect();
    let mut out = String::with_capacity(chars.len());
    for (i, &ch) in chars.iter().enumerate() {
        if SEPARATORS.contains(&ch) {
            let prev_digit = out.chars().last().is_some_and(|c| c.is_ascii_digit());
            let next_digit = chars[i + 1..].iter().find(|c| !SEPARATORS.contains(c)).is_some_and(|c| c.is_ascii_digit());
            if prev_digit && next_digit {
                continue;
            }
        }
        out.push(ch);
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Documento de identidad: sin separadores entre dígitos y en mayúsculas (conserva el prefijo «CC»).
pub fn document(value: &str, max: usize) -> String {
    strip_digit_separators(value).to_uppercase().chars().take(max).collect()
}

/// Teléfono: sin espacios, puntos, guiones ni paréntesis; conserva un «+» inicial.
pub fn phone(value: &str, max: usize) -> String {
    let cleaned: String = value.trim().chars().filter(|c| !matches!(c, ' ' | '.' | '-' | '(' | ')' | '\u{a0}')).collect();
    cleaned.to_uppercase().chars().take(max).collect()
}

/// Solo los dígitos de un texto (para comparar documentos).
pub fn digits(value: &str) -> String {
    value.chars().filter(|c| c.is_ascii_digit()).collect()
}

/// NIT y DV por separado. «900.123.456-7» con DV vacío → («900123456», «7»).
/// Si trae un DV que contradice al del campo DV, devuelve error.
pub fn nit_and_dv(nit: &str, dv: &str) -> Result<(String, String), String> {
    let raw = nit.trim();
    let dv = digits(dv);
    let (body, inline_dv) = match raw.rsplit_once('-') {
        Some((head, tail)) if tail.trim().len() == 1 && tail.trim().chars().all(|c| c.is_ascii_digit()) && head.chars().any(|c| c.is_ascii_digit()) => (head, Some(tail.trim().to_string())),
        _ => (raw, None),
    };
    let nit = strip_digit_separators(body);
    let dv = match (inline_dv, dv.is_empty()) {
        (Some(inline), true) => inline,
        (Some(inline), false) if inline != dv => return Err("El NIT incluye un DV distinto al del campo DV.".into()),
        _ => dv,
    };
    Ok((nit, dv))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uppercases_with_accents_and_collapses_spaces() {
        assert_eq!(upper_text("  perez   gómez  ñandú ", 100), "PEREZ GÓMEZ ÑANDÚ");
        assert_eq!(upper_text("abcdef", 3), "ABC");
    }

    #[test]
    fn strips_separators_only_between_digits() {
        assert_eq!(document("cc 1.192.729.629", 60), "CC 1192729629");
        assert_eq!(document("1 192 729 629", 60), "1192729629");
        assert_eq!(document("ce 99-123", 60), "CE 99123");
        assert_eq!(document("pa AB-12", 60), "PA AB-12");
    }

    #[test]
    fn phones_lose_visual_separators() {
        assert_eq!(phone("+57 300 123-4567", 60), "+573001234567");
        assert_eq!(phone("(601) 234 5678", 60), "6012345678");
        assert_eq!(phone("300.123.4567 ext 2", 60), "3001234567EXT2");
    }

    #[test]
    fn splits_nit_and_dv() {
        assert_eq!(nit_and_dv("900.123.456", "7").unwrap(), ("900123456".into(), "7".into()));
        assert_eq!(nit_and_dv("900.123.456-7", "").unwrap(), ("900123456".into(), "7".into()));
        assert_eq!(nit_and_dv("901679752 - 3", "3").unwrap(), ("901679752".into(), "3".into()));
        assert!(nit_and_dv("900123456-7", "1").is_err());
        assert_eq!(nit_and_dv("9 0 0 1 2 3 4 5 6", " 7 ").unwrap(), ("900123456".into(), "7".into()));
    }

    #[test]
    fn digits_extracts_only_numbers() {
        assert_eq!(digits("CC 1.020.713.259"), "1020713259");
    }
}
