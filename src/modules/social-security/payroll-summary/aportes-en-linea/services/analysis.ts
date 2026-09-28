import type { PdfDocumentText } from "../../../../bank-analysis/shared/pdf/pdfTypes";
import type { PayrollAnalysis } from "../../shared/types";
import { parseAportesEnLinea } from "../parser/aportesEnLineaParser";
import { validatePayroll } from "./validation";

/** Texto del PDF → resumen de la planilla + validación contra sus propios totales. */
export function analyzeAportesEnLinea(text: PdfDocumentText): PayrollAnalysis {
  const summary = parseAportesEnLinea(text);
  return { summary, validation: validatePayroll(summary) };
}
