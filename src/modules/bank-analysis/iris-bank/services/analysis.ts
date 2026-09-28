import { groupMovements } from "../../shared/groupingService";
import type { PdfDocumentText } from "../../shared/pdf/pdfTypes";
import { summarize } from "../../shared/summaryService";
import type { MovementGroup, ParsedStatement, StatementSummary, StatementValidation } from "../../shared/types";
import { parseIrisBankStatement } from "../parser/irisBankParser";
import { validateIrisBank } from "./validation";

export interface IrisBankAnalysis {
  statement: ParsedStatement;
  groups: MovementGroup[];
  summary: StatementSummary;
  validation: StatementValidation;
}

/** Parser → agrupación por descripción exacta + signo → resumen → validación. Nada se guarda. */
export function analyzeIrisBank(text: PdfDocumentText): IrisBankAnalysis {
  const statement = parseIrisBankStatement(text);
  const groups = groupMovements(statement.movements);
  const summary = summarize(statement.movements, groups);
  return { statement, groups, summary, validation: validateIrisBank(statement, groups, summary) };
}
