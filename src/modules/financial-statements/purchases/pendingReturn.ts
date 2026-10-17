import { useSyncExternalStore } from "react";
import type { Dest } from "./domain/status";

/**
 * Ruta de regreso al panel de pendientes cuando el dato a resolver vive en otro módulo (p. ej. el perfil de IVA en Empresas).
 * Guarda destino, empresa, año y la posición del panel; la franja «Volver a pendientes» y Compras la consumen al regresar.
 */
export interface PendingReturn {
  dest: Dest;
  buyerNit: string;
  year: number | null;
  companyName: string;
  /** Posición de desplazamiento y grupos abiertos del panel al salir. */
  scroll: number;
  expanded: string[];
  /** Ficha de empresa que debe abrir Empresas (NIT) y su pestaña. */
  openCompanyNit?: string;
  companyTab?: "fiscal";
  /** La franja ya pidió volver: Compras debe reabrir el panel. */
  returning?: boolean;
}

let current: PendingReturn | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getPendingReturn = () => current;

export function setPendingReturn(value: PendingReturn | null) {
  current = value;
  emit();
}

export function patchPendingReturn(patch: Partial<PendingReturn>) {
  if (current) setPendingReturn({ ...current, ...patch });
}

/** Lee y borra el contexto (se usa una sola vez al regresar). */
export function takePendingReturn(): PendingReturn | null {
  const value = current;
  setPendingReturn(null);
  return value;
}

export function usePendingReturn(): PendingReturn | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
