import type { PdfDocumentText } from "../../../../bank-analysis/shared/pdf/pdfTypes";
import { PlanillaDetectionError, type NormalizedPlanilla } from "../types";

/**
 * SOI: el punto de extensión está preparado, pero NO hay lector: no se declara soporte hasta contar con un PDF real
 * para verificarlo. Un PDF de SOI debe rechazarse con un mensaje claro, no leerse a medias.
 */
export function normalizeSoi(_doc: PdfDocumentText): NormalizedPlanilla {
  throw new PlanillaDetectionError("SOI todavía no está soportado. Importa la planilla desde Aportes en Línea o MiPlanilla.");
}
