import type { BankCoverageState } from "../model";

/** Cobertura completa, parcial o faltante de un banco en el año (texto y tono de la insignia). */
export const COVERAGE_TEXT: Record<BankCoverageState, { text: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  complete: { text: "Cobertura completa", tone: "success" },
  partial: { text: "Cobertura parcial", tone: "warning" },
  missing: { text: "Cobertura faltante", tone: "danger" },
  na: { text: "No aplica en el año", tone: "neutral" },
};
