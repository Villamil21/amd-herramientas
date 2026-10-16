import { useCallback, useSyncExternalStore } from "react";

/**
 * Empresa y año que se están trabajando en Información Exógena. Se recuerdan entre pantallas (y al reabrir la app) para no
 * volver a elegirlos en cada formato. La Exógena es anual: el año va del 01/01 al 31/12.
 */
export interface ExogenaSelection {
  companyId: number | null;
  year: number;
}

const KEY = "exogena.selection";

/** El año a informar por defecto es el anterior al actual (se declara en el año siguiente). */
export const defaultYear = (today = new Date()) => today.getFullYear() - 1;

function read(): ExogenaSelection {
  const fallback: ExogenaSelection = { companyId: null, year: defaultYear() };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ExogenaSelection>;
    return {
      companyId: typeof parsed.companyId === "number" ? parsed.companyId : null,
      year: typeof parsed.year === "number" && parsed.year >= 2000 && parsed.year <= 2100 ? parsed.year : fallback.year,
    };
  } catch {
    return fallback;
  }
}

let current = read();
const listeners = new Set<() => void>();

function set(patch: Partial<ExogenaSelection>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* preferencia de comodidad: si no se puede guardar, la selección sigue valiendo durante la sesión */
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useExogenaSelection(): [ExogenaSelection, (patch: Partial<ExogenaSelection>) => void] {
  const selection = useSyncExternalStore(subscribe, () => current);
  const update = useCallback((patch: Partial<ExogenaSelection>) => set(patch), []);
  return [selection, update];
}
