import type { PdfDocumentText } from "../../shared/pdf/pdfTypes";
import { parseBancoomevaStatement } from "../parser/bancoomevaParser";
import type { BancoomevaGroup, BancoomevaStatement, BancoomevaSummary, BancoomevaValidation } from "../types";
import { groupBancoomevaMovements, summarizeBancoomeva } from "./grouping";
import { validateBancoomeva } from "./validation";

export interface BancoomevaAnalysis {
  statement: BancoomevaStatement;
  groups: BancoomevaGroup[];
  summary: BancoomevaSummary;
  validation: BancoomevaValidation;
}

/** Parser → agrupación → resumen → validación, sobre el texto ya extraído. Nada se guarda. */
export function analyzeBancoomeva(text: PdfDocumentText): BancoomevaAnalysis {
  const statement = parseBancoomevaStatement(text);
  const groups = groupBancoomevaMovements(statement.movements);
  const summary = summarizeBancoomeva(statement.movements, groups);
  return { statement, groups, summary, validation: validateBancoomeva(statement, groups, summary) };
}
