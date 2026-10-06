import type { PdfDocumentText } from "../../shared/pdf/pdfTypes";
import { parseBbvaStatement } from "../parser/bbvaParser";
import type { BbvaGroup, BbvaStatement, BbvaSummary, BbvaValidation } from "../types";
import { groupBbvaMovements, summarizeBbva } from "./grouping";
import { validateBbva } from "./validation";

export interface BbvaAnalysis {
  statement: BbvaStatement;
  groups: BbvaGroup[];
  summary: BbvaSummary;
  validation: BbvaValidation;
}

/** Parser → agrupación → resumen → validación, sobre el texto ya extraído. Nada se guarda. */
export function analyzeBbva(text: PdfDocumentText): BbvaAnalysis {
  const statement = parseBbvaStatement(text);
  const groups = groupBbvaMovements(statement.movements);
  const summary = summarizeBbva(statement.movements, groups);
  return { statement, groups, summary, validation: validateBbva(statement, groups, summary) };
}
