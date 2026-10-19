import type { PdfDocumentText } from "../../../bank-analysis/shared/pdf/pdfTypes";
import { normalizeAportesEnLinea } from "./adapters/aportesEnLinea";
import { normalizeMiPlanilla } from "./adapters/miPlanilla";
import { normalizeSoi } from "./adapters/soi";
import { detectOperator } from "./detect";
import { PlanillaDetectionError, type NormalizedPlanilla, type OperatorId } from "./types";

const ADAPTERS: Record<OperatorId, (doc: PdfDocumentText) => NormalizedPlanilla> = {
  "aportes-en-linea": normalizeAportesEnLinea,
  miplanilla: normalizeMiPlanilla,
  soi: normalizeSoi,
};

/** PDF → planilla normalizada, detectando el operador. El usuario no elige operador. */
export function normalizePlanilla(doc: PdfDocumentText): NormalizedPlanilla {
  const operator = detectOperator(doc);
  if (!operator) throw new PlanillaDetectionError("No se reconoció el operador de la planilla. Importa un PDF de Aportes en Línea o de MiPlanilla.");
  return ADAPTERS[operator](doc);
}
