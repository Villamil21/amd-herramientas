import type { CompanyVatEntry } from "../../../../types/purchases";

/**
 * ¿Era responsable de IVA durante el periodo? Mismo criterio que `vat_responsible_in` de Rust (que es el que decide al guardar):
 * vale la entrada vigente al inicio; si no era responsable, cuenta una alta dentro del periodo. `undefined` = se desconoce (sin
 * historial anterior al fin del periodo): no se bloquea, pero tampoco se supone.
 */
export function vatResponsibleIn(history: readonly Pick<CompanyVatEntry, "effectiveDate" | "responsible">[], start: string, end: string): boolean | undefined {
  const atStart = [...history].filter((e) => e.effectiveDate <= start).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  if (atStart?.responsible) return true;
  if (history.some((e) => e.effectiveDate > start && e.effectiveDate <= end && e.responsible)) return true;
  return history.some((e) => e.effectiveDate <= end) ? false : undefined;
}

export const VAT_NOT_RESPONSIBLE_MESSAGE = "La empresa no era responsable de IVA (responsabilidad 48) en este periodo según su historial de IVA: la declaración no se registra ni se importa. Si es un error, corrige el historial en Datos → Empresas → Fiscal.";
