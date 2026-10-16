/**
 * Registro de formatos de Información Exógena. En esta fase solo están implementados 1010 y 1009; el resto queda
 * registrado (con su código y nombre confirmados) para agregarlo después sin cambiar la infraestructura: una pantalla
 * "no disponible" nunca se presenta como terminada.
 *
 * Fuera de alcance, y por eso ausentes: 5253 y 2278.
 */

export type ColumnKind = "text" | "integer";

export interface FormatColumn {
  /** Clave en `RecordData`. */
  key: string;
  /** Encabezado exacto, en el orden pactado. */
  header: string;
  kind: ColumnKind;
}

export interface FormatDef {
  code: string;
  name: string;
  /** Título de la hoja en el Excel exportado. */
  sheetTitle: string;
  implemented: boolean;
  /** Columnas del formato en orden (solo los implementados). */
  columns?: FormatColumn[];
}

export const FORMAT_1010_COLUMNS: FormatColumn[] = [
  { key: "docTypeCode", header: "Tipo de documento", kind: "text" },
  { key: "docNumber", header: "Número identificación del socio o accionista", kind: "text" },
  { key: "dv", header: "DV", kind: "text" },
  { key: "firstSurname", header: "Primer apellido del accionista", kind: "text" },
  { key: "secondSurname", header: "Segundo apellido del accionista", kind: "text" },
  { key: "firstName", header: "Primer nombre del accionista", kind: "text" },
  { key: "otherNames", header: "Otros nombres del accionista", kind: "text" },
  { key: "businessName", header: "Razón social del accionista", kind: "text" },
  { key: "address", header: "Dirección", kind: "text" },
  { key: "deptCode", header: "Código departamento", kind: "text" },
  { key: "muniCode", header: "Código municipio", kind: "text" },
  { key: "countryCode", header: "País residencia o domicilio", kind: "text" },
  { key: "nominalValue", header: "Valor nominal de la acción, aporte o derecho social a 31 diciembre", kind: "integer" },
  { key: "premium", header: "Valor prima en colocación de acciones a 31 diciembre", kind: "integer" },
  { key: "pctInteger", header: "Porcentaje de participación", kind: "integer" },
  { key: "pctDecimal", header: "Porcentaje de participación (posición decimal)", kind: "integer" },
];

export const FORMAT_1009_COLUMNS: FormatColumn[] = [
  { key: "concept", header: "Concepto", kind: "text" },
  { key: "docTypeCode", header: "Tipo de documento", kind: "text" },
  { key: "docNumber", header: "Número identificación", kind: "text" },
  { key: "dv", header: "DV", kind: "text" },
  { key: "firstSurname", header: "Primer apellido", kind: "text" },
  { key: "secondSurname", header: "Segundo apellido", kind: "text" },
  { key: "firstName", header: "Primer nombre", kind: "text" },
  { key: "otherNames", header: "Otros nombres", kind: "text" },
  { key: "businessName", header: "Razón social", kind: "text" },
  { key: "address", header: "Dirección", kind: "text" },
  { key: "deptCode", header: "Código dpto.", kind: "text" },
  { key: "muniCode", header: "Código mcp", kind: "text" },
  { key: "countryCode", header: "País de residencia o domicilio", kind: "text" },
  { key: "balance", header: "Saldo cuentas por pagar al 31-12", kind: "integer" },
];

export const FORMATS: FormatDef[] = [
  { code: "1001", name: "Pagos o abonos en cuenta y retenciones practicadas", sheetTitle: "Pagos o abonos en cuenta y retenciones practicadas", implemented: false },
  { code: "1003", name: "Retenciones en la fuente que le practicaron", sheetTitle: "Retenciones en la fuente que le practicaron", implemented: false },
  { code: "1004", name: "Descuentos tributarios solicitados", sheetTitle: "Descuentos tributarios solicitados", implemented: false },
  { code: "1005", name: "Impuesto a las ventas por pagar (descontable)", sheetTitle: "Impuesto a las ventas por pagar (descontable)", implemented: false },
  { code: "1006", name: "Impuesto a las ventas por pagar (generado) e impuesto al consumo", sheetTitle: "Impuesto a las ventas por pagar (generado) e impuesto al consumo", implemented: false },
  { code: "1007", name: "Ingresos recibidos", sheetTitle: "Ingresos recibidos", implemented: false },
  { code: "1008", name: "Saldo de cuentas por cobrar al 31 de diciembre", sheetTitle: "Saldo de cuentas por cobrar al 31 de diciembre", implemented: false },
  { code: "1009", name: "Saldos de cuentas por pagar al 31 de diciembre", sheetTitle: "Saldo de cuentas por pagar al 31 de diciembre", implemented: true, columns: FORMAT_1009_COLUMNS },
  { code: "1010", name: "Socios, accionistas y similares", sheetTitle: "Información de socios, accionistas, comuneros y/o cooperados", implemented: true, columns: FORMAT_1010_COLUMNS },
  { code: "1011", name: "Información de las declaraciones tributarias", sheetTitle: "Información de las declaraciones tributarias", implemented: false },
  { code: "1012", name: "Información de declaraciones tributarias, acciones y aportes, inversiones y cuentas", sheetTitle: "Información de declaraciones tributarias, acciones y aportes, inversiones en bonos títulos valores y cuentas de ahorro y cuentas corrientes", implemented: false },
  { code: "1056", name: "Pagos o abonos en cuenta y retenciones por secretarios generales que administran recursos del tesoro", sheetTitle: "Pagos o abonos en cuenta y retenciones por secretarios generales que administran recursos del tesoro", implemented: false },
  { code: "1647", name: "Ingresos recibidos para terceros", sheetTitle: "Ingresos recibidos para terceros", implemented: false },
  { code: "2275", name: "Ingresos no constitutivos de renta ni ganancia ocasional", sheetTitle: "Ingresos no constitutivos de renta ni ganancia ocasional", implemented: false },
  { code: "2276", name: "Información de rentas de trabajo y pensiones", sheetTitle: "Información de rentas de trabajo y pensiones", implemented: false },
];

/** Formatos con pantalla en esta fase, en el orden de las tarjetas. */
export const IMPLEMENTED_FORMATS = FORMATS.filter((f) => f.implemented);

export const findFormat = (code: string) => FORMATS.find((f) => f.code === code);

/** Años que se ofrecen para informar: el año gravable actual y los cinco anteriores. */
export function selectableYears(today = new Date()): number[] {
  const current = today.getFullYear();
  return Array.from({ length: 6 }, (_, i) => current - i);
}

/** Corte anual: siempre del 1 de enero al 31 de diciembre del año informado. */
export const yearRange = (year: number) => ({ start: `${year}-01-01`, end: `${year}-12-31` });
