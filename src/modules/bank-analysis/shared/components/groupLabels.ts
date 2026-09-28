/** Nombres de columnas y textos de la tabla agrupada; cada banco usa los de su extracto. */
export interface GroupLabels {
  description: string;
  searchPlaceholder: string;
  tableDescription: string;
  branch: string;
  document: string;
  /** Título de la columna de fecha en el detalle (por defecto «Fecha»). */
  date?: string;
  /** Título de la columna del importe en el detalle (por defecto «Valor»). */
  value?: string;
  /** Permite ordenar también por Tipo (signo). */
  sortableType?: boolean;
}

/** Textos del extracto Bancolombia (valores por defecto). */
export const DEFAULT_GROUP_LABELS: GroupLabels = {
  description: "Descripción",
  searchPlaceholder: "Buscar descripción...",
  tableDescription: "Agrupados por descripción exacta y signo del valor. Haz clic en un grupo para ver sus movimientos.",
  branch: "Sucursal",
  document: "Dcto.",
};
