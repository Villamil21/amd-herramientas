/**
 * Columnas del reporte de documentos electrónicos. Se identifican por el
 * NOMBRE del encabezado (sin importar tildes, mayúsculas ni posición).
 */
export const MAIN_COLUMNS = {
  tipoDocumento: "Tipo de documento",
  fechaEmision: "Fecha Emisión",
  nitEmisor: "NIT Emisor",
  nombreEmisor: "Nombre Emisor",
  total: "Total",
} as const;

/** Impuestos que se restan del Total para obtener la base (columnas N a Z del reporte). */
export const TAX_COLUMNS = [
  "IVA", "ICA", "IC", "INC", "Timbre", "INC Bolsas", "IN Carbono",
  "IN Combustibles", "IC Datos", "ICL", "INPP", "IBUA", "ICUI",
] as const;

/** Retenciones ya registradas en el archivo (columnas AA a AC): generan alerta. */
export const PRIOR_RETENTION_COLUMNS = ["Rete IVA", "Rete Renta", "Rete ICA"] as const;

export const REQUIRED_COLUMNS: string[] = [
  ...Object.values(MAIN_COLUMNS),
  ...TAX_COLUMNS,
  ...PRIOR_RETENTION_COLUMNS,
];

/** Tipos de documento reconocidos y su efecto sobre los valores. */
export const DOCUMENT_TYPES = [
  { name: "Factura electrónica", sign: 1 as const },
  { name: "Nota Crédito electrónica", sign: -1 as const },
];
