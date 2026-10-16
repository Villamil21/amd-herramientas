import { EERR_SECTIONS, ESF_SECTIONS, SECTION_LABEL, type FsCatalog, type FsPucMapping } from "../../../types/fs";

/**
 * Presentación en Estados Financieros de una cuenta PUC. La ubicación se configura y se presenta por los primeros cuatro dígitos
 * (2365 → una sola clasificación para todas sus subcuentas); el código completo sigue identificando cada concepto contable.
 * Un mapeo del código completo, si existe, tiene prioridad (es lo que usa el Generador).
 */
export interface Presentation {
  family: string;
  state: "line" | "excluded" | "none";
  text: string;
}

export function presentationOf(code: string, catalog: FsCatalog | null, mappings: Map<string, FsPucMapping>): Presentation {
  const family = code.slice(0, 4);
  const m = mappings.get(code) ?? mappings.get(family);
  if (!m) return { family, state: "none", text: "Sin clasificar" };
  if (m.excluded) return { family, state: "excluded", text: "No afecta Estados Financieros" };
  const line = catalog?.lines.find((l) => l.id === m.lineId);
  if (!line) return { family, state: "none", text: "Sin clasificar" };
  const side = ESF_SECTIONS.includes(line.section) ? "ESF" : EERR_SECTIONS.includes(line.section) ? "EERR" : "";
  return { family, state: "line", text: `${side ? `${side} › ` : ""}${SECTION_LABEL[line.section]} › ${line.name}` };
}
