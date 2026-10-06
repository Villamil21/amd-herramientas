import type { Assignments, FileResult } from "../types";
import type { InvoiceFolder } from "./folder";

/**
 * Análisis en curso. Vive en memoria mientras la app está abierta: salir a
 * otra pantalla (por ejemplo a Datos → Tabla de Códigos PUC) y volver no
 * pierde los códigos ya asignados. No se escribe en disco ni crea reglas
 * «descripción → código»; al cerrar la app o analizar otra carpeta se descarta.
 * (Los códigos usados con cada proveedor sí se guardan: van en SQLite.)
 */
export interface PucSession {
  folder: InvoiceFolder;
  results: FileResult[];
  assignments: Assignments;
}

let current: PucSession | null = null;

export const loadSession = () => current;

export function saveSession(session: PucSession | null) {
  current = session;
}
