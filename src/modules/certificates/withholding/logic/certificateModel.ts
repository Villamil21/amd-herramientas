/**
 * Modelo único del certificado. La vista previa y el PDF se construyen a
 * partir de este mismo objeto, por eso no pueden diferir.
 */
import type { Company, TipoRetencion, UnidadTarifa } from "../../../../types/models";
import { UNIDAD_TARIFA_SYMBOL } from "../../../../types/models";
import { formatDateTime, formatYearMonth } from "../../../../utils/dates";
import { formatMoneyCents, formatRate } from "../../../../utils/format";
import { parseRate } from "../../../../utils/numbers";
import type { ExcelAnalysis } from "./excelAnalysis";
import { certificateFileName, certificateTitle, retainedCents } from "./calculations";

export const CERTIFICATE_FOOTER =
  "Este documento no requiere para su validez firma autógrafa de acuerdo con el artículo 10 del Decreto 836 de 1991.";

/** Concepto agregado al certificado (copia editable del concepto guardado). */
export interface CertificateConceptLine {
  key: string;
  conceptId: number | null;
  nombre: string;
  tipo: TipoRetencion | null;
  unidad: UnidadTarifa | null;
  rateText: string;
}

export interface CertificateDocument {
  issuer: {
    razonSocial: string;
    nit: string;
    telefono: string;
    direccion: string;
    logoDataUrl: string | null;
  };
  title: string;
  info: { label: string; value: string }[];
  rateHeader: string;
  rows: { index: number; concepto: string; tasa: string; base: string; valor: string }[];
  footer: string;
  fileName: string;
}

export interface CertificateInput {
  company: Company | null;
  logoDataUrl: string | null;
  analysis: ExcelAnalysis | null;
  lines: CertificateConceptLine[];
  consignadoEn: string;
  generatedAt: Date;
}

/** Errores que impiden generar el certificado (lenguaje de usuario). */
export function validateCertificate(input: Omit<CertificateInput, "generatedAt">): string[] {
  const errors: string[] = [];
  if (!input.company) errors.push("Selecciona la empresa emisora.");
  if (!input.analysis) errors.push("Importa el archivo Excel.");
  else if (input.analysis.errors.length > 0) errors.push("Corrige los errores del archivo Excel.");
  if (input.lines.length === 0) errors.push("Agrega al menos un concepto.");
  input.lines.forEach((line, i) => {
    const n = i + 1;
    if (!line.conceptId || !line.nombre) errors.push(`Selecciona el concepto de la fila ${n}.`);
    else if (!line.tipo) errors.push(`El concepto de la fila ${n} no tiene tipo de retención.`);
    if (!line.unidad) errors.push(`El concepto de la fila ${n} no tiene unidad de tarifa definida.`);
    const rate = parseRate(line.rateText);
    if (rate === null || rate <= 0) errors.push(`La tarifa de la fila ${n} no es válida.`);
    else if (line.unidad === "PORCENTAJE" && rate > 100) errors.push(`La tarifa de la fila ${n} supera el 100 %.`);
    else if (line.unidad === "POR_MIL" && rate > 1000) errors.push(`La tarifa de la fila ${n} supera el 1000 ‰.`);
  });
  if (!input.consignadoEn.trim()) errors.push("Indica dónde fue consignado (CONSIGNADO EN).");
  return errors;
}

function rateHeader(units: UnidadTarifa[]): { header: string; showUnit: boolean } {
  const unique = new Set(units);
  if (unique.size === 1 && unique.has("PORCENTAJE")) return { header: "TASA %", showUnit: false };
  if (unique.size === 1 && unique.has("POR_MIL")) return { header: "TASA ‰", showUnit: false };
  return { header: "TASA", showUnit: true };
}

/** Requiere un input válido (ver `validateCertificate`). */
export function buildCertificateDocument(input: CertificateInput): CertificateDocument {
  const { company, analysis } = input;
  if (!company || !analysis || !analysis.retenido || !analysis.period) {
    throw new Error("Certificado incompleto");
  }
  const lines = input.lines.filter((l) => l.tipo && l.unidad);
  const tipos = lines.map((l) => l.tipo!);
  const { header, showUnit } = rateHeader(lines.map((l) => l.unidad!));
  const base = formatMoneyCents(analysis.baseCents);

  return {
    issuer: {
      razonSocial: company.razonSocial,
      nit: company.nit,
      telefono: company.telefono,
      direccion: company.direccion,
      logoDataUrl: input.logoDataUrl,
    },
    title: certificateTitle(tipos),
    info: [
      { label: "PERIODO GRAVABLE", value: analysis.period.label },
      { label: "RETENIDO A", value: analysis.retenido.nombre },
      { label: "NIT", value: analysis.retenido.nit },
      { label: "CONSIGNADO EN", value: input.consignadoEn.trim().toUpperCase() },
      { label: "FECHA Y HORA DE GENERACIÓN", value: formatDateTime(input.generatedAt) },
    ],
    rateHeader: header,
    rows: lines.map((line, i) => {
      const rate = parseRate(line.rateText) ?? 0;
      return {
        index: i + 1,
        concepto: line.nombre,
        tasa: showUnit ? `${formatRate(rate)} ${UNIDAD_TARIFA_SYMBOL[line.unidad!]}` : formatRate(rate),
        base,
        valor: formatMoneyCents(retainedCents(analysis.baseCents, rate, line.unidad!)),
      };
    }),
    footer: CERTIFICATE_FOOTER,
    fileName: certificateFileName(
      tipos,
      analysis.retenido.nombre,
      formatYearMonth(analysis.period.start),
      formatYearMonth(analysis.period.end),
    ),
  };
}
