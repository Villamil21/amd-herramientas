import type { PdfDocumentText } from "../../shared/pdf/pdfTypes";
import { parseCoopcentralStatement } from "../parser/coopcentralParser";
import type { CoopcentralGroup, CoopcentralStatement, CoopcentralSummary, CoopcentralValidation } from "../types";
import { groupCoopcentralMovements, summarizeCoopcentral } from "./grouping";
import { validateCoopcentral } from "./validation";

export interface CoopcentralAnalysis {
  statement: CoopcentralStatement;
  groups: CoopcentralGroup[];
  summary: CoopcentralSummary;
  validation: CoopcentralValidation;
}

/** Parser → agrupación → resumen → validación, sobre el texto ya extraído. Nada se guarda. */
export function analyzeCoopcentral(text: PdfDocumentText): CoopcentralAnalysis {
  const statement = parseCoopcentralStatement(text);
  const groups = groupCoopcentralMovements(statement.movements);
  const summary = summarizeCoopcentral(statement.movements, groups);
  return { statement, groups, summary, validation: validateCoopcentral(statement, groups, summary) };
}
