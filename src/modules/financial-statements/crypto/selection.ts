import { useCallback, useSyncExternalStore } from "react";

/** Empresa y año de reporte que se están trabajando en Transacciones Cripto (se recuerdan entre pantallas y al reabrir la app). */
export interface CryptoSelection {
  companyId: number | null;
  year: number;
}

const KEY = "crypto.selection";
const fallback = (): CryptoSelection => ({ companyId: null, year: new Date().getFullYear() });

function read(): CryptoSelection {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback();
    const parsed = JSON.parse(raw) as Partial<CryptoSelection>;
    return {
      companyId: typeof parsed.companyId === "number" ? parsed.companyId : null,
      year: typeof parsed.year === "number" && parsed.year >= 2000 && parsed.year <= 2100 ? parsed.year : fallback().year,
    };
  } catch {
    return fallback();
  }
}

let current = read();
const listeners = new Set<() => void>();

function set(patch: Partial<CryptoSelection>) {
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

export function useCryptoSelection(): [CryptoSelection, (patch: Partial<CryptoSelection>) => void] {
  const selection = useSyncExternalStore(subscribe, () => current);
  return [selection, useCallback((patch) => set(patch), [])];
}

/** Años que se ofrecen: el actual, los cinco anteriores y el siguiente. */
export function selectableYears(today = new Date()): number[] {
  const y = today.getFullYear();
  return Array.from({ length: 7 }, (_, i) => y + 1 - i);
}
