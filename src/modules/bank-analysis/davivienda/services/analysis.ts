import { groupMovements } from "../../shared/groupingService";
import type { PdfDocumentText } from "../../shared/pdf/pdfTypes";
import { summarize } from "../../shared/summaryService";
import type { MovementGroup, ParsedStatement, StatementSummary, StatementValidation } from "../../shared/types";
import { parseDaviviendaStatement } from "../parser/daviviendaParser";
import { validateDavivienda } from "./validation";

export interface DaviviendaAnalysis {
  statement: ParsedStatement;
  groups: MovementGroup[];
  summary: StatementSummary;
  validation: StatementValidation;
}

/** Parser → agrupación por clase exacta + signo → resumen → validación. Nada se guarda. */
export function analyzeDavivienda(text: PdfDocumentText): DaviviendaAnalysis {
  const statement = parseDaviviendaStatement(text);
  const groups = groupMovements(statement.movements);
  const summary = summarize(statement.movements, groups);
  return { statement, groups, summary, validation: validateDavivienda(statement, groups, summary) };
}
