//! Exportación de los formatos de Información Exógena a un único .xlsx.
//!
//! Una hoja por formato (nombre = código del formato, como en la plantilla oficial «Formatos informantes básicos»).
//! Cada hoja trae arriba una franja de identificación (logo y datos de la empresa, año gravable y nombre del formato)
//! y, separado por una fila en blanco, el rango tabular: UNA fila de encabezados (en el orden pactado de cada formato)
//! y luego solo los registros. La franja nunca se mezcla con el rango de datos.
//!
//! Reglas de los valores: los identificadores y códigos van como TEXTO (conservan los ceros: país 169, departamento 05,
//! municipio 001) y los montos y porcentajes como ENTEROS sin separadores, moneda ni decimales. El redondeo al entero
//! más cercano lo hace el frontend antes de enviar; aquí un valor con decimales se rechaza en lugar de truncarse.

use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, IgnoreError, Image, Workbook, XlsxError};
use serde::Deserialize;

use crate::error::{AppError, AppResult};

const MAX_SHEETS: usize = 20;
const MAX_ROWS: usize = 1_000_000;
const MAX_COLUMNS: usize = 30;
/// Filas de la franja de identificación (0-based: 0..=3) y fila del encabezado de la tabla.
pub const IDENTIFICATION_ROWS: u32 = 4;
pub const HEADER_ROW: u32 = 5;
/// La franja de texto empieza en esta columna (A y B quedan para el logo).
const TEXT_COLUMN: u16 = 2;

#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CellKind {
    /// Identificadores, códigos y textos.
    Text,
    /// Montos y porcentajes: entero sin formato.
    Integer,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExogenaColumn {
    pub header: String,
    pub kind: CellKind,
}

#[derive(Debug, Deserialize, Clone, PartialEq)]
#[serde(untagged)]
pub enum ExogenaCell {
    Integer(i64),
    Text(String),
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExogenaSheet {
    /// Código del formato («1009»).
    pub name: String,
    /// «Saldo de cuentas por pagar al 31 de diciembre».
    pub title: String,
    pub columns: Vec<ExogenaColumn>,
    pub rows: Vec<Vec<Option<ExogenaCell>>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExogenaWorkbook {
    pub company_name: String,
    /// NIT con DV tal como se muestra («901741186-9»).
    pub company_nit: String,
    pub year: i64,
    pub sheets: Vec<ExogenaSheet>,
}

fn xlsx_error(e: XlsxError) -> AppError {
    eprintln!("[exogena-xlsx] {e}");
    AppError::user("No se pudo generar el archivo Excel.")
}

fn column_width(sheet: &ExogenaSheet, c: usize) -> f64 {
    let header = sheet.columns[c].header.chars().count();
    let longest = sheet
        .rows
        .iter()
        .filter_map(|r| r.get(c))
        .map(|cell| match cell {
            Some(ExogenaCell::Text(t)) => t.chars().count(),
            Some(ExogenaCell::Integer(n)) => n.to_string().len(),
            None => 0,
        })
        .max()
        .unwrap_or(0);
    (header.min(28).max(longest) as f64 + 3.0).clamp(12.0, 60.0)
}

/// `logo`: bytes PNG/JPG de la empresa (opcional).
pub fn build_workbook(book: &ExogenaWorkbook, logo: Option<&[u8]>) -> AppResult<Vec<u8>> {
    if book.sheets.is_empty() || book.sheets.len() > MAX_SHEETS {
        return Err(AppError::user("No hay formatos para exportar."));
    }
    let title = Format::new().set_bold().set_font_size(12.0);
    let label = Format::new().set_bold();
    let header = Format::new()
        .set_bold()
        .set_font_color(Color::RGB(0xFFFFFF))
        .set_background_color(Color::RGB(0x0D141A))
        .set_border_bottom(FormatBorder::Thin)
        .set_align(FormatAlign::Center)
        .set_text_wrap();
    let integer = Format::new().set_num_format("0");

    let mut workbook = Workbook::new();
    for sheet in &book.sheets {
        if sheet.columns.is_empty() || sheet.columns.len() > MAX_COLUMNS || sheet.rows.len() > MAX_ROWS {
            return Err(AppError::user("La información a exportar excede el tamaño permitido."));
        }
        let ws = workbook.add_worksheet();
        ws.set_name(&sheet.name).map_err(xlsx_error)?;

        // Franja de identificación: no forma parte del rango tabular.
        ws.write_string_with_format(0, TEXT_COLUMN, "EMPRESA:", &label).map_err(xlsx_error)?;
        ws.write_string_with_format(0, TEXT_COLUMN + 1, &book.company_name, &title).map_err(xlsx_error)?;
        ws.write_string_with_format(1, TEXT_COLUMN, "NIT:", &label).map_err(xlsx_error)?;
        ws.write_string(1, TEXT_COLUMN + 1, &book.company_nit).map_err(xlsx_error)?;
        ws.write_string_with_format(2, TEXT_COLUMN, "AÑO GRAVABLE:", &label).map_err(xlsx_error)?;
        ws.write_string(2, TEXT_COLUMN + 1, &book.year.to_string()).map_err(xlsx_error)?;
        ws.write_string_with_format(3, TEXT_COLUMN, &format!("Formato {}:", sheet.name), &label).map_err(xlsx_error)?;
        ws.write_string(3, TEXT_COLUMN + 1, &sheet.title).map_err(xlsx_error)?;
        if let Some(bytes) = logo {
            // Un logo ilegible no impide exportar: la hoja sale con los datos de la empresa.
            if let Ok(image) = Image::new_from_buffer(bytes) {
                let image = image.set_scale_to_size(150.0, 76.0, true);
                ws.insert_image_with_offset(0, 0, &image, 4, 2).map_err(xlsx_error)?;
            }
        }
        for r in 0..IDENTIFICATION_ROWS {
            ws.set_row_height(r, 20.0).map_err(xlsx_error)?;
        }

        // Encabezado y registros.
        for (c, col) in sheet.columns.iter().enumerate() {
            ws.write_string_with_format(HEADER_ROW, c as u16, &col.header, &header).map_err(xlsx_error)?;
            ws.set_column_width(c as u16, column_width(sheet, c)).map_err(xlsx_error)?;
        }
        ws.set_row_height(HEADER_ROW, 45.0).map_err(xlsx_error)?;
        for (r, row) in sheet.rows.iter().enumerate() {
            let r = HEADER_ROW + 1 + r as u32;
            for (c, cell) in row.iter().enumerate().take(sheet.columns.len()) {
                let col = c as u16;
                match (cell, sheet.columns[c].kind) {
                    (None, _) => {}
                    (Some(ExogenaCell::Integer(n)), CellKind::Integer) => {
                        ws.write_number_with_format(r, col, *n as f64, &integer).map_err(xlsx_error)?;
                    }
                    // Un número en una columna de texto (código sin ceros perdidos ya viene como texto) se escribe como texto.
                    (Some(ExogenaCell::Integer(n)), CellKind::Text) => {
                        ws.write_string(r, col, &n.to_string()).map_err(xlsx_error)?;
                    }
                    (Some(ExogenaCell::Text(t)), CellKind::Text) => {
                        ws.write_string(r, col, t).map_err(xlsx_error)?;
                    }
                    (Some(ExogenaCell::Text(_)), CellKind::Integer) => {
                        return Err(AppError::user("Un monto o porcentaje debe ser un número entero."));
                    }
                }
            }
        }
        if !sheet.rows.is_empty() {
            let last = HEADER_ROW + sheet.rows.len() as u32;
            for (c, col) in sheet.columns.iter().enumerate() {
                if col.kind == CellKind::Text {
                    ws.ignore_error_range(HEADER_ROW + 1, c as u16, last, c as u16, IgnoreError::NumberStoredAsText).map_err(xlsx_error)?;
                }
            }
        }
        ws.autofilter(HEADER_ROW, 0, HEADER_ROW + sheet.rows.len() as u32, (sheet.columns.len() - 1) as u16).map_err(xlsx_error)?;
        ws.set_freeze_panes(HEADER_ROW + 1, 0).map_err(xlsx_error)?;
    }
    workbook.save_to_buffer().map_err(xlsx_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::{open_workbook_auto_from_rs, Data, Reader};
    use std::io::Cursor;

    fn col(header: &str, kind: CellKind) -> ExogenaColumn {
        ExogenaColumn { header: header.into(), kind }
    }

    fn text(v: &str) -> Option<ExogenaCell> {
        Some(ExogenaCell::Text(v.into()))
    }

    fn int(v: i64) -> Option<ExogenaCell> {
        Some(ExogenaCell::Integer(v))
    }

    fn sample() -> ExogenaWorkbook {
        ExogenaWorkbook {
            company_name: "GLOWING DIGITAL CLOUD S.A.S.".into(),
            company_nit: "901741186-9".into(),
            year: 2025,
            sheets: vec![
                ExogenaSheet {
                    name: "1009".into(),
                    title: "Saldo de cuentas por pagar al 31 de diciembre".into(),
                    columns: vec![col("Concepto", CellKind::Text), col("Tipo de documento", CellKind::Text), col("Número identificación", CellKind::Text), col("Código dpto.", CellKind::Text), col("Código mcp", CellKind::Text), col("País de residencia o domicilio", CellKind::Text), col("Saldo cuentas por pagar al 31-12", CellKind::Integer)],
                    rows: vec![vec![text("2201"), text("31"), text("0800197268"), text("05"), text("001"), text("169"), int(1_000_001)], vec![text("2204"), text("13"), text("1192816998"), text("76"), text("001"), text("169"), int(250_000)]],
                },
                ExogenaSheet {
                    name: "1010".into(),
                    title: "Información de socios, accionistas, comuneros y/o cooperados".into(),
                    columns: vec![col("Tipo de documento", CellKind::Text), col("Número identificación del socio o accionista", CellKind::Text), col("Valor Nominal", CellKind::Integer), col("Valor prima", CellKind::Integer), col("Porcentaje de participación", CellKind::Integer), col("Porcentaje de participación (posición decimal)", CellKind::Integer)],
                    rows: vec![vec![text("13"), text("1192816998"), int(60_000_000), int(0), int(50), int(20)]],
                },
            ],
        }
    }

    fn png_1px() -> Vec<u8> {
        crate::services::signatures::tests::png_1px()
    }

    fn read(bytes: Vec<u8>) -> calamine::Sheets<Cursor<Vec<u8>>> {
        open_workbook_auto_from_rs(Cursor::new(bytes)).unwrap()
    }

    #[test]
    fn sheets_are_named_by_format_with_identification_above_the_table() {
        let mut wb = read(build_workbook(&sample(), Some(&png_1px())).unwrap());
        assert_eq!(wb.sheet_names(), vec!["1009".to_string(), "1010".to_string()]);
        let range = wb.worksheet_range("1009").unwrap();
        let cell = |r: u32, c: u32| range.get_value((r, c)).cloned().unwrap_or(Data::Empty);
        // Franja de identificación (columna C en adelante; A y B son del logo).
        assert_eq!(cell(0, 2), Data::String("EMPRESA:".into()));
        assert_eq!(cell(0, 3), Data::String("GLOWING DIGITAL CLOUD S.A.S.".into()));
        assert_eq!(cell(1, 3), Data::String("901741186-9".into()));
        assert_eq!(cell(2, 3), Data::String("2025".into()));
        assert_eq!(cell(3, 3), Data::String("Saldo de cuentas por pagar al 31 de diciembre".into()));
        // La fila 5 (índice 4) queda en blanco y el encabezado va en la fila 6.
        for c in 0..7 {
            assert_eq!(cell(4, c), Data::Empty);
        }
        assert_eq!(cell(HEADER_ROW, 0), Data::String("Concepto".into()));
        assert_eq!(cell(HEADER_ROW, 6), Data::String("Saldo cuentas por pagar al 31-12".into()));
        // Solo encabezado + registros en el rango tabular: 1 + 2 filas.
        let table_rows = (HEADER_ROW..range.end().unwrap().0 + 1).filter(|r| (0..7).any(|c| cell(*r, c) != Data::Empty)).count();
        assert_eq!(table_rows, 3);
    }

    #[test]
    fn identifiers_keep_leading_zeros_and_amounts_are_plain_integers() {
        let mut wb = read(build_workbook(&sample(), None).unwrap());
        let range = wb.worksheet_range("1009").unwrap();
        let row = HEADER_ROW + 1;
        let get = |c: u32| range.get_value((row, c)).cloned().unwrap();
        assert_eq!(get(0), Data::String("2201".into()));
        assert_eq!(get(2), Data::String("0800197268".into()), "el número conserva su cero inicial");
        assert_eq!(get(3), Data::String("05".into()), "departamento");
        assert_eq!(get(4), Data::String("001".into()), "municipio");
        assert_eq!(get(5), Data::String("169".into()), "país");
        // 1.000.000,5 ya llegó redondeado a 1000001: sin separadores ni decimales.
        assert_eq!(get(6), Data::Float(1_000_001.0));
        let participation = wb.worksheet_range("1010").unwrap();
        assert_eq!(participation.get_value((row, 4)), Some(&Data::Float(50.0)));
        assert_eq!(participation.get_value((row, 5)), Some(&Data::Float(20.0)));
        assert_eq!(participation.get_value((row, 3)), Some(&Data::Float(0.0)), "prima en colocación siempre 0");
        assert_eq!(participation.get_value((row, 0)), Some(&Data::String("13".into())));
    }

    #[test]
    fn the_logo_is_embedded_when_available_and_optional_when_not() {
        let with_logo = build_workbook(&sample(), Some(&png_1px())).unwrap();
        let without = build_workbook(&sample(), None).unwrap();
        let has_media = |bytes: &[u8]| bytes.windows(b"xl/media/".len()).any(|w| w == b"xl/media/");
        assert!(has_media(&with_logo), "el logo viaja dentro del libro");
        assert!(!has_media(&without));
        // Un archivo que no es imagen no impide exportar.
        assert!(build_workbook(&sample(), Some(b"no es una imagen")).is_ok());
    }

    #[test]
    fn rejects_empty_or_malformed_exports() {
        let mut empty = sample();
        empty.sheets.clear();
        assert!(build_workbook(&empty, None).is_err());
        let mut bad = sample();
        bad.sheets[0].rows[0][6] = text("1.000.000,5");
        assert!(build_workbook(&bad, None).is_err(), "un monto en texto no se acepta");
        let json = r#"{"companyName":"E","companyNit":"1","year":2025,"sheets":[{"name":"1010","title":"t","columns":[{"header":"h","kind":"integer"}],"rows":[[1000000.5]]}]}"#;
        assert!(serde_json::from_str::<ExogenaWorkbook>(json).is_err(), "los decimales no deserializan: el redondeo es del frontend");
    }
}
