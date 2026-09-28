import { parseUiafBytes } from "../parser/uiafTxtParser";
import type { UiafAnalysis } from "../types";
import { validateUiaf } from "./validation";

/** Lectura → validación, en el equipo. Nada se guarda ni se envía. */
export function analyzeUiafTxt(bytes: Uint8Array): UiafAnalysis {
  const report = parseUiafBytes(bytes);
  return { report, validation: validateUiaf(report) };
}
