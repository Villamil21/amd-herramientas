/** Clave de sessionStorage con la que otra pantalla pide abrir una declaración concreta en Obligaciones tributarias. */
export const OPEN_RETURN_KEY = "fs.taxObligations.openReturn";

export function peekOpenReturn(): { companyId: number; returnId: number } | null {
  try {
    const raw = sessionStorage.getItem(OPEN_RETURN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { companyId?: unknown; returnId?: unknown };
    return typeof v.companyId === "number" && typeof v.returnId === "number" ? { companyId: v.companyId, returnId: v.returnId } : null;
  } catch {
    return null;
  }
}

export function clearOpenReturn() {
  try {
    sessionStorage.removeItem(OPEN_RETURN_KEY);
  } catch {
    // Sin almacenamiento no hay nada que limpiar.
  }
}
