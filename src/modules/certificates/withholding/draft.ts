import type { ExcelAnalysis } from "./logic/excelAnalysis";
import type { CertificateConceptLine } from "./logic/certificateModel";

export const STEPS = ["Empresa", "Importar Excel", "Revisar información", "Conceptos y tarifas", "Vista previa", "Generar PDF"];

export interface WithholdingDraft {
  step: number;
  companyId: number | null;
  analysis: ExcelAnalysis | null;
  /** El usuario confirmó conscientemente las retenciones previas del archivo. */
  priorAck: boolean;
  lines: CertificateConceptLine[];
  consignadoEn: string;
  consignadoTouched: boolean;
  result: { path: string; fileName: string } | null;
}

export const emptyDraft = (): WithholdingDraft => ({
  step: 0,
  companyId: null,
  analysis: null,
  priorAck: false,
  lines: [],
  consignadoEn: "",
  consignadoTouched: false,
  result: null,
});

/**
 * El borrador se conserva mientras la app esté abierta, aunque el usuario
 * navegue a otra sección (p. ej. para crear un concepto) y regrese.
 */
let cache: WithholdingDraft | null = null;
export const readDraft = () => cache ?? emptyDraft();
export const saveDraft = (d: WithholdingDraft) => {
  cache = d;
};

let keySeq = 0;
export const newLineKey = () => `l${Date.now()}-${keySeq++}`;
