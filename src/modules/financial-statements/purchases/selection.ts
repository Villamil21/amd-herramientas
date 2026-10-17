import { useCallback, useSyncExternalStore } from "react";

/** Empresa (NIT comprador) y año que se están trabajando en Compras, costos y exógena; se recuerdan entre pantallas. */
export interface PurchasesSelection {
  buyerNit: string | null;
  /** null = facturas sin fecha de expedición. */
  year: number | null;
}

const KEY = "purchases.selection";
const fallback = (): PurchasesSelection => ({ buyerNit: null, year: new Date().getFullYear() });

function read(): PurchasesSelection {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback();
    const parsed = JSON.parse(raw) as Partial<PurchasesSelection>;
    return {
      buyerNit: typeof parsed.buyerNit === "string" && parsed.buyerNit ? parsed.buyerNit : null,
      year: parsed.year === null ? null : typeof parsed.year === "number" && parsed.year >= 2000 && parsed.year <= 2100 ? parsed.year : fallback().year,
    };
  } catch {
    return fallback();
  }
}

let current = read();
const listeners = new Set<() => void>();

function set(patch: Partial<PurchasesSelection>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* preferencia de comodidad */
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePurchasesSelection(): [PurchasesSelection, (patch: Partial<PurchasesSelection>) => void] {
  const selection = useSyncExternalStore(subscribe, () => current);
  return [selection, useCallback((patch) => set(patch), [])];
}
