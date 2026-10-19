import type { PdfDocumentText } from "../../../bank-analysis/shared/pdf/pdfTypes";
import type { OperatorId } from "./types";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ");

/**
 * Operador de un PDF de planilla a partir de su texto, sin intervención del usuario. `undefined` = no se reconoce
 * (incluye SOI: el adaptador está preparado pero no se declara soporte hasta tener un PDF real).
 */
export function detectOperator(doc: PdfDocumentText): OperatorId | undefined {
  const text = norm(
    doc.pages
      .slice(0, 2)
      .flatMap((p) => p.items.filter((i) => !i.rotated).map((i) => i.text))
      .join(" "),
  );
  if (text.includes("PLANILLA INTEGRADA DE AUTOLIQUIDACION DE APORTES")) return "miplanilla";
  if (text.includes("PLANILLA RESUMEN") && text.includes("DATOS GENERALES DEL APORTANTE")) return "aportes-en-linea";
  return undefined;
}
