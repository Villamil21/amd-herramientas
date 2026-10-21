/**
 * Registro de formatos de Información Exógena. Están implementados 1010, 1009, 1008, 1007 y 1647 (Transacciones Cripto), 1001, 1005 y 1006 (Compras, costos y exógena) y 1011 y 2276 (Nómina y seguridad social); el resto queda
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

export const FORMAT_1008_COLUMNS: FormatColumn[] = [
  { key: "concept", header: "Concepto", kind: "text" },
  { key: "docTypeCode", header: "Tipo de documento", kind: "text" },
  { key: "docNumber", header: "Número identificación deudor", kind: "text" },
  { key: "dv", header: "DV", kind: "text" },
  { key: "firstSurname", header: "Primer apellido deudor", kind: "text" },
  { key: "secondSurname", header: "Segundo apellido deudor", kind: "text" },
  { key: "firstName", header: "Primer nombre deudor", kind: "text" },
  { key: "otherNames", header: "Otros nombres deudor", kind: "text" },
  { key: "businessName", header: "Razón social deudor", kind: "text" },
  { key: "address", header: "Dirección", kind: "text" },
  { key: "deptCode", header: "Código dpto", kind: "text" },
  { key: "muniCode", header: "Código mcp", kind: "text" },
  { key: "countryCode", header: "País de Residencia o domicilio", kind: "text" },
  { key: "balance", header: "Saldo cuentas por cobrar al 31-12", kind: "integer" },
];

/** 1007 · Ingresos recibidos (se arma desde Transacciones Cripto → Reporte de operaciones y desde Ventas → Facturación electrónica; concepto siempre 4001). */
export const FORMAT_1007_COLUMNS: FormatColumn[] = [
  { key: "concept", header: "Concepto", kind: "text" },
  { key: "docTypeCode", header: "Tipo de documento", kind: "text" },
  { key: "docNumber", header: "Número de identificación", kind: "text" },
  { key: "dv", header: "DV", kind: "text" },
  { key: "firstSurname", header: "Primer apellido", kind: "text" },
  { key: "secondSurname", header: "Segundo apellido", kind: "text" },
  { key: "firstName", header: "Primer nombre", kind: "text" },
  { key: "otherNames", header: "Otros nombres", kind: "text" },
  { key: "businessName", header: "Razón social", kind: "text" },
  { key: "countryCode", header: "País de residencia o domicilio", kind: "text" },
  { key: "grossIncome", header: "Ingresos brutos recibidos", kind: "integer" },
  { key: "returns", header: "Devoluciones, rebajas y descuentos", kind: "integer" },
];

/** 1647 · Ingresos recibidos para terceros (concepto siempre 4070): el tercero para quien se recibió el ingreso y quien lo recibió. */
export const FORMAT_1647_COLUMNS: FormatColumn[] = [
  { key: "concept", header: "Concepto", kind: "text" },
  { key: "docTypeCode", header: "Tipo de documento del tercero", kind: "text" },
  { key: "docNumber", header: "Número de identificación del tercero", kind: "text" },
  { key: "dv", header: "DV del tercero", kind: "text" },
  { key: "firstSurname", header: "Primer apellido del tercero", kind: "text" },
  { key: "secondSurname", header: "Segundo apellido del tercero", kind: "text" },
  { key: "firstName", header: "Primer nombre del tercero", kind: "text" },
  { key: "otherNames", header: "Otros nombres del tercero", kind: "text" },
  { key: "businessName", header: "Razón social del tercero", kind: "text" },
  { key: "address", header: "Dirección", kind: "text" },
  { key: "deptCode", header: "Código dpto", kind: "text" },
  { key: "muniCode", header: "Código mcp", kind: "text" },
  { key: "countryCode", header: "País de residencia o domicilio", kind: "text" },
  { key: "totalValue", header: "Valor total de la operación", kind: "integer" },
  { key: "reintegratedValue", header: "Valor ingreso reintegrado transferido distribuido al tercero", kind: "integer" },
  { key: "withholdingValue", header: "Valor retención reintegrada transferida distribuida al tercero", kind: "integer" },
  { key: "recipientCountryCode", header: "País de quien recibió el ingreso", kind: "text" },
  { key: "recipientDocTypeCode", header: "Tipo de documento de quien recibió el ingreso", kind: "text" },
  { key: "recipientDocNumber", header: "Número de identificación de quien recibió el ingreso", kind: "text" },
  { key: "recipientDv", header: "DV de quien recibió el ingreso", kind: "text" },
  { key: "recipientFirstSurname", header: "Primer apellido de quien recibió el ingreso", kind: "text" },
  { key: "recipientSecondSurname", header: "Segundo apellido de quien recibió el ingreso", kind: "text" },
  { key: "recipientFirstName", header: "Primer nombre de quien recibió el ingreso", kind: "text" },
  { key: "recipientOtherNames", header: "Otros nombres de quien recibió el ingreso", kind: "text" },
  { key: "recipientBusinessName", header: "Razón social de quien recibió el ingreso", kind: "text" },
];

/** 1001 · Pagos o abonos en cuenta y retenciones practicadas (se arma desde Estados Financieros → Compras, costos y exógena; una fila por tercero y concepto). */
export const FORMAT_1001_COLUMNS: FormatColumn[] = [
  { key: "concept", header: "Concepto", kind: "text" },
  { key: "docTypeCode", header: "Tipo de documento", kind: "text" },
  { key: "docNumber", header: "Número de identificación", kind: "text" },
  { key: "dv", header: "DV", kind: "text" },
  { key: "firstSurname", header: "Primer apellido del tercero", kind: "text" },
  { key: "secondSurname", header: "Segundo apellido del tercero", kind: "text" },
  { key: "firstName", header: "Primer nombre del tercero", kind: "text" },
  { key: "otherNames", header: "Otros nombres del tercero", kind: "text" },
  { key: "businessName", header: "Razón social del tercero", kind: "text" },
  { key: "address", header: "Dirección", kind: "text" },
  { key: "deptCode", header: "Código dpto.", kind: "text" },
  { key: "muniCode", header: "Código mcp", kind: "text" },
  { key: "countryCode", header: "País de residencia o domicilio", kind: "text" },
  { key: "deductible", header: "Pago o abono en cuenta deducible", kind: "integer" },
  { key: "nonDeductible", header: "Pago o abono en cuenta no deducible", kind: "integer" },
  { key: "ivaDeductible", header: "IVA mayor valor del costo o gasto deducible", kind: "integer" },
  { key: "ivaNonDeductible", header: "IVA mayor valor del costo o gasto no deducible", kind: "integer" },
  { key: "retPracticed", header: "Retención en la fuente practicada en renta", kind: "integer" },
  { key: "retAssumed", header: "Retención en la fuente asumida en renta", kind: "integer" },
  { key: "retIvaResponsible", header: "Retención en la fuente practicada IVA a responsables del IVA", kind: "integer" },
  { key: "retIvaNonResident", header: "Retención en la fuente practicada IVA a no residentes o no domiciliados", kind: "integer" },
];

/** 1005 · Impuesto a las ventas descontable (por tercero, sin conceptos; solo empresas responsables de IVA). Compras aporta el descontable; las notas crédito de Facturación electrónica, el IVA por devoluciones en ventas. */
export const FORMAT_1005_COLUMNS: FormatColumn[] = [
  { key: "docTypeCode", header: "Tipo de documento", kind: "text" },
  { key: "docNumber", header: "Número de identificación del informado", kind: "text" },
  { key: "dv", header: "DV", kind: "text" },
  { key: "firstSurname", header: "Primer apellido del informado", kind: "text" },
  { key: "secondSurname", header: "Segundo apellido del informado", kind: "text" },
  { key: "firstName", header: "Primer nombre del informado", kind: "text" },
  { key: "otherNames", header: "Otros nombres del informado", kind: "text" },
  { key: "businessName", header: "Razón social del informado", kind: "text" },
  { key: "discountable", header: "Impuesto descontable", kind: "integer" },
  { key: "salesReturns", header: "IVA resultante por devoluciones en ventas anuladas, rescindidas o resueltas", kind: "integer" },
  { key: "costIva", header: "IVA tratado como mayor valor del costo o gasto", kind: "integer" },
];

/** 1006 · Impuesto a las ventas generado e impuesto al consumo (solo empresas responsables de IVA). Compras aporta el IVA recuperado en devoluciones; las facturas de Facturación electrónica, el impuesto generado. */
export const FORMAT_1006_COLUMNS: FormatColumn[] = [
  { key: "docTypeCode", header: "Tipo de documento", kind: "text" },
  { key: "docNumber", header: "Número de identificación del informado", kind: "text" },
  { key: "dv", header: "DV", kind: "text" },
  { key: "firstSurname", header: "Primer apellido del informado", kind: "text" },
  { key: "secondSurname", header: "Segundo apellido del informado", kind: "text" },
  { key: "firstName", header: "Primer nombre del informado", kind: "text" },
  { key: "otherNames", header: "Otros nombres del informado", kind: "text" },
  { key: "businessName", header: "Razón social del informado", kind: "text" },
  { key: "generated", header: "Impuesto generado", kind: "integer" },
  { key: "purchaseReturns", header: "IVA recuperado en devoluciones en compras anuladas, rescindidas o resueltas", kind: "integer" },
  { key: "consumption", header: "Impuesto al consumo", kind: "integer" },
];

/** 1011 · Información de las declaraciones tributarias: una cifra anual por concepto (sin terceros). Fase inicial: 8207, 8241, 8242, 8243, 8244, 8245 y 8295 desde Nómina. */
export const FORMAT_1011_COLUMNS: FormatColumn[] = [
  { key: "concept", header: "Concepto", kind: "text" },
  { key: "balance", header: "Saldo a dic. 31", kind: "integer" },
];

/** 2276 · Rentas de trabajo y pensiones: un registro anual por empleado (versión 4, AG 2024). Los encabezados son los de la plantilla DIAN. */
export const FORMAT_2276_COLUMNS: FormatColumn[] = [
  { key: "entity", header: "Entidad informante", kind: "text" },
  { key: "docTypeCode", header: "Tipo de documento del beneficiario", kind: "text" },
  { key: "docNumber", header: "Número de identificación del beneficiario", kind: "text" },
  { key: "firstSurname", header: "Primer apellido del beneficiario", kind: "text" },
  { key: "secondSurname", header: "Segundo apellido del beneficiario", kind: "text" },
  { key: "firstName", header: "Primer nombre del beneficiario", kind: "text" },
  { key: "otherNames", header: "Otros nombres del beneficiario", kind: "text" },
  { key: "address", header: "Dirección del beneficiario", kind: "text" },
  { key: "deptCode", header: "Departamento del beneficiario", kind: "text" },
  { key: "muniCode", header: "Municipio del beneficiario", kind: "text" },
  { key: "countryCode", header: "País del beneficiario", kind: "text" },
  { key: "salaries", header: "Pagos por salarios", kind: "integer" },
  { key: "ecclesiastical", header: "Pagos por emolumentos eclesiásticos", kind: "integer" },
  { key: "vouchers", header: "Pagos realizados con bonos electrónicos o de papel de servicio, cheques, tarjetas, vales, etc.", kind: "integer" },
  { key: "foodExcess", header: "Valor del exceso de los pagos por alimentación mayores a 41 UVT, artículo 387-1 E.T.", kind: "integer" },
  { key: "fees", header: "Pagos por honorarios", kind: "integer" },
  { key: "services", header: "Pagos por servicios", kind: "integer" },
  { key: "commissions", header: "Pagos por comisiones", kind: "integer" },
  { key: "benefits", header: "Pagos por prestaciones sociales", kind: "integer" },
  { key: "perDiem", header: "Pagos por viáticos", kind: "integer" },
  { key: "representation", header: "Pagos por gastos de representación", kind: "integer" },
  { key: "cooperative", header: "Pagos por compensacionales trabajo asociado cooperativo", kind: "integer" },
  { key: "educationSupport", header: "Valor apoyos económicos no reembolsables o condonados, entregados por el Estado o financiados con recursos públicos, para financiar programas educativos.", kind: "integer" },
  { key: "otherPayments", header: "Otros pagos", kind: "integer" },
  { key: "severanceAndInterest", header: "Cesantías e intereses de cesantías efectivamente pagadas al empleado", kind: "integer" },
  { key: "severanceFund", header: "Cesantías consignadas al fondo de cesantías", kind: "integer" },
  { key: "severanceAid", header: "Auxilio de cesantías reconocido a trabajadores del régimen tradicional del Código Sustantivo del Trabajo, capítulo VII, título VIII, parte primera", kind: "integer" },
  { key: "pensions", header: "Pensiones de jubilación, vejez o invalidez", kind: "integer" },
  { key: "grossTotal", header: "Total ingresos brutos de rentas de trabajo y pensión", kind: "integer" },
  { key: "healthContribution", header: "Aportes obligatorios por salud a cargo del trabajador", kind: "integer" },
  { key: "pensionContribution", header: "Aportes obligatorios a fondos de pensiones y solidaridad pensional a cargo del trabajador", kind: "integer" },
  { key: "voluntaryRais", header: "Aportes voluntarios al régimen de ahorro individual con solidaridad –RAIS–", kind: "integer" },
  { key: "voluntaryFunds", header: "Aportes voluntarios a fondos de pensiones voluntarias", kind: "integer" },
  { key: "afc", header: "Aportes a cuentas AFC", kind: "integer" },
  { key: "avc", header: "Aportes a cuentas AVC", kind: "integer" },
  { key: "withholding", header: "Valor de las retenciones en la fuente por pagos de rentas de trabajo o pensiones", kind: "integer" },
  { key: "ivaHigher", header: "Impuesto sobre las ventas –IVA–, mayor valor del costo o gasto", kind: "integer" },
  { key: "ivaWithholding", header: "Retención en la fuente a título de impuesto sobre las ventas –IVA–", kind: "integer" },
  { key: "foodUpTo", header: "Pagos por alimentación hasta 41 UVT", kind: "integer" },
  { key: "avgIncome6m", header: "Valor ingreso laboral promedio de los últimos seis meses", kind: "integer" },
  { key: "dependentDocType", header: "Tipo de documento del dependiente económico", kind: "text" },
  { key: "dependentDocNumber", header: "Número de identificación del dependiente económico", kind: "text" },
  { key: "trustId", header: "Identificación del fideicomiso", kind: "text" },
  { key: "collabDocType", header: "Tipo de documento participante en contrato de colaboración", kind: "text" },
  { key: "collabId", header: "Identificación participante en contrato colaboración", kind: "text" },
];

export const FORMATS: FormatDef[] = [
  { code: "1001", name: "Pagos o abonos en cuenta y retenciones practicadas", sheetTitle: "Pagos o abonos en cuenta y retenciones practicadas", implemented: true, columns: FORMAT_1001_COLUMNS },
  { code: "1003", name: "Retenciones en la fuente que le practicaron", sheetTitle: "Retenciones en la fuente que le practicaron", implemented: false },
  { code: "1004", name: "Descuentos tributarios solicitados", sheetTitle: "Descuentos tributarios solicitados", implemented: false },
  { code: "1005", name: "Impuesto a las ventas por pagar (descontable)", sheetTitle: "Impuesto a las ventas por pagar (descontable)", implemented: true, columns: FORMAT_1005_COLUMNS },
  { code: "1006", name: "Impuesto a las ventas por pagar (generado) e impuesto al consumo", sheetTitle: "Impuesto a las ventas por pagar (generado) e impuesto al consumo", implemented: true, columns: FORMAT_1006_COLUMNS },
  { code: "1007", name: "Ingresos recibidos", sheetTitle: "Ingresos recibidos", implemented: true, columns: FORMAT_1007_COLUMNS },
  { code: "1008", name: "Saldo de cuentas por cobrar al 31 de diciembre", sheetTitle: "Saldo de cuentas por cobrar al 31 de diciembre", implemented: true, columns: FORMAT_1008_COLUMNS },
  { code: "1009", name: "Saldos de cuentas por pagar al 31 de diciembre", sheetTitle: "Saldo de cuentas por pagar al 31 de diciembre", implemented: true, columns: FORMAT_1009_COLUMNS },
  { code: "1010", name: "Socios, accionistas y similares", sheetTitle: "Información de socios, accionistas, comuneros y/o cooperados", implemented: true, columns: FORMAT_1010_COLUMNS },
  { code: "1011", name: "Información de las declaraciones tributarias", sheetTitle: "Información de las declaraciones tributarias", implemented: true, columns: FORMAT_1011_COLUMNS },
  { code: "1012", name: "Información de declaraciones tributarias, acciones y aportes, inversiones y cuentas", sheetTitle: "Información de declaraciones tributarias, acciones y aportes, inversiones en bonos títulos valores y cuentas de ahorro y cuentas corrientes", implemented: false },
  { code: "1056", name: "Pagos o abonos en cuenta y retenciones por secretarios generales que administran recursos del tesoro", sheetTitle: "Pagos o abonos en cuenta y retenciones por secretarios generales que administran recursos del tesoro", implemented: false },
  { code: "1647", name: "Ingresos recibidos para terceros", sheetTitle: "Ingresos recibidos para terceros", implemented: true, columns: FORMAT_1647_COLUMNS },
  { code: "2275", name: "Ingresos no constitutivos de renta ni ganancia ocasional", sheetTitle: "Ingresos no constitutivos de renta ni ganancia ocasional", implemented: false },
  { code: "2276", name: "Información de rentas de trabajo y pensiones", sheetTitle: "Información de rentas de trabajo y pensiones", implemented: true, columns: FORMAT_2276_COLUMNS },
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
