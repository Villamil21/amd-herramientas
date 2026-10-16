/**
 * Datos registrales de la Cámara de Comercio para las Notas Financieras: constitución, inscripción (número, fecha y libro),
 * Cámara, ciudad y objeto social. Solo se extrae lo que el certificado dice con claridad: lo demás queda en `review`
 * («Revisar») para que el usuario lo complete a mano. Nunca se inventa texto.
 */

export type RegistralField =
  | "entityNarrative"
  | "corporatePurpose"
  | "registryChamber"
  | "registryCity"
  | "constitutionDocType"
  | "constitutionDate"
  | "registryNumber"
  | "registryDate"
  | "registryBook";

export const REGISTRAL_FIELDS: RegistralField[] = ["entityNarrative", "corporatePurpose", "registryChamber", "registryCity", "constitutionDocType", "constitutionDate", "registryNumber", "registryDate", "registryBook"];

export const REGISTRAL_LABEL: Record<RegistralField, string> = {
  entityNarrative: "Ente económico",
  corporatePurpose: "Objeto social",
  registryChamber: "Cámara de Comercio",
  registryCity: "Ciudad de inscripción",
  constitutionDocType: "Tipo de documento de constitución",
  constitutionDate: "Fecha de constitución",
  registryNumber: "Número de inscripción",
  registryDate: "Fecha de inscripción",
  registryBook: "Libro",
};

export type RegistralValues = Record<RegistralField, string>;

export interface RegistralData {
  /** Solo lo extraído con certeza (los demás campos no aparecen). */
  values: Partial<RegistralValues>;
  /** Campos que el certificado no permitió confirmar. */
  review: RegistralField[];
}

const MONTHS: Record<string, string> = { enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12" };

/** «05 de julio de 2024» → «2024-07-05»; null si no es una fecha real. */
export function spanishDateToIso(day: string, month: string, year: string): string | null {
  const m = MONTHS[month.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
  const d = Number(day);
  const y = Number(year);
  if (!m || !(d >= 1 && d <= 31) || !(y >= 1900 && y <= 2100)) return null;
  const iso = `${year}-${m}-${String(d).padStart(2, "0")}`;
  const probe = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(probe.getTime()) || probe.getUTCMonth() + 1 !== Number(m) ? null : iso;
}

/** «2024-07-05» → «05 de julio de 2024». */
export function isoToSpanishLong(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const name = Object.entries(MONTHS).find(([, v]) => v === m[2])?.[0] ?? "";
  return `${m[3]} de ${name} de ${m[1]}`;
}

const SMALL = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "para", "en"]);
const ACRONYMS = /^(?:s\.?a\.?s?\.?|s\.?a\.?|ltda\.?|e\.?s\.?p\.?|e\.?u\.?|s\.?c\.?a\.?|s\.? en c\.?|nit|cia|ccc)$/i;

/** «CÁMARA DE COMERCIO DE SINCELEJO» → «Cámara de Comercio de Sincelejo»; conserva siglas societarias (SAS, LTDA). */
export function titleCase(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word, i) => {
      if (word.includes("&")) return word.toUpperCase();
      if (ACRONYMS.test(word)) return word.toUpperCase();
      const lower = word.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      return lower.replace(/(^|[-/(])([a-záéíóúñü])/g, (_, p: string, c: string) => p + c.toUpperCase());
    })
    .join(" ");
}

const HEADINGS = /^(?:T[ÉE]RMINO(?:\s+DE\s+DURACI[ÓO]N)?|REFORMAS(?:\s+ESPECIALES)?|OBJETO\s+SOCIAL|CAPITAL(?:\s+(?:AUTORIZADO|SUSCRITO|PAGADO))?|REPRESENTACI[ÓO]N\s+LEGAL|[ÓO]RGANOS\s+DE\s+ADMINISTRACI[ÓO]N.*|NOMBRAMIENTOS?|FACULTADES.*|JUNTA\s+DIRECTIVA|REVISOR(?:ES)?\s+FISCAL(?:ES)?|ESTABLECIMIENTOS?.*|ACTIVIDAD(?:ES)?\s+ECON[ÓO]MICA.*|INFORMACI[ÓO]N\s+COMPLEMENTARIA|CERTIFICA|DISOLUCI[ÓO]N.*|LIQUIDACI[ÓO]N.*|SITUACIONES?\s+DE\s+CONTROL.*|RECURSOS\s+CONTRA.*|\*{0,2}\s*CAPITAL\s+.*\*{0,2}|DOCUMENTO\s+INSCRIPCI[ÓO]N.*)$/i;
const isHeading = (line: string) => HEADINGS.test(line.replace(/[*:]/g, "").trim());

function sectionAfter(lines: string[], head: RegExp): { start: number; body: string[]; closed: boolean } | null {
  const start = lines.findIndex((l) => head.test(l.trim()));
  if (start < 0) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeading(lines[i]) && !head.test(lines[i].trim())) return { start, body, closed: true };
    body.push(lines[i]);
  }
  return { start, body, closed: false };
}

const DOC_TYPE_LABEL: [RegExp, string][] = [
  [/^documento\s+privado/i, "Documento privado"],
  [/^escritura\s+p[uú]blica/i, "Escritura pública"],
  [/^acta/i, "Acta"],
  [/^certificaci[oó]n/i, "Certificación"],
  [/^formulario/i, "Formulario"],
  [/^sentencia/i, "Sentencia"],
  [/^resoluci[oó]n/i, "Resolución"],
];

/** Texto compuesto por hechos extraídos (nunca por suposiciones): lo usan la importación y la regeneración manual. */
export function composeEntityNarrative(args: { name: string; domicileCity: string; chamber: string; constitutionDate: string; registryNumber: string; registryBook: string }): string {
  const { name, domicileCity, chamber, constitutionDate, registryNumber, registryBook } = args;
  if (!name.trim() || !chamber.trim() || !constitutionDate) return "";
  const where = domicileCity.trim() ? ` con domicilio en ${domicileCity.trim()}` : "";
  const inscription = registryNumber.trim() ? ` con el No. ${registryNumber.trim()}${registryBook.trim() ? ` del Libro ${registryBook.trim()}` : ""}` : "";
  return `${name.trim()}${where} es una entidad privada, constituida ante la ${chamber.trim()}, el día ${isoToSpanishLong(constitutionDate)}${inscription}`;
}

export function parseRegistral(pages: string[][], lines: string[], context: { razonSocial?: string }): RegistralData {
  const values: Partial<RegistralValues> = {};
  const review = new Set<RegistralField>();

  // Cámara: el título del certificado («Cámara de Comercio de Medellín para Antioquia»).
  const chamberLine = (pages[0] ?? []).slice(0, 6).find((l) => /^c[aá]mara\s+de\s+comercio\s+de\s+[\p{L}\s.]+$/iu.test(l));
  if (chamberLine) {
    const city = chamberLine.replace(/^c[aá]mara\s+de\s+comercio\s+de\s+/i, "").replace(/\s+para\s+.+$/i, "").trim();
    if (city) {
      values.registryChamber = titleCase(`Cámara de Comercio de ${city}`);
      values.registryCity = titleCase(city);
    }
  }

  // Constitución: «Por Documento Privado del 05 de julio de 2024 de la Constitución, inscrito … con el No. 5955 del Libro IX».
  const constitution = sectionAfter(lines, /^constituci[oó]n$/i);
  const text = constitution ? constitution.body.join(" ").replace(/\s+/g, " ") : "";
  const doc = /^Por\s+(.{3,40}?)\s+(?:No\.?\s*[\w-]+\s+)?del?\s+(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+de\s+(\d{4})/i.exec(text);
  if (doc) {
    const date = spanishDateToIso(doc[2], doc[3], doc[4]);
    const label = DOC_TYPE_LABEL.find(([re]) => re.test(doc[1]))?.[1];
    if (date) values.constitutionDate = date;
    if (label) values.constitutionDocType = label;
  }
  const numbers = [...text.matchAll(/con\s+el\s+No\.?\s*(\d+)\s+del\s+libro\s+([IVX]+|\d+)/gi)];
  const distinct = new Set(numbers.map((m) => `${m[1]}|${m[2].toUpperCase()}`));
  if (distinct.size === 1) {
    values.registryNumber = numbers[0][1];
    values.registryBook = numbers[0][2].toUpperCase();
  }
  // Fecha de inscripción en ESTA Cámara (si el acto se inscribió antes en otra, solo cuenta «en esta Cámara de Comercio el …»).
  const here = [...text.matchAll(/en\s+esta\s+c[aá]mara\s+de\s+comercio\s+el\s+(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+de\s+(\d{4})/gi)];
  const hereDates = new Set(here.map((m) => spanishDateToIso(m[1], m[2], m[3])).filter(Boolean));
  if (hereDates.size === 1) values.registryDate = [...hereDates][0]!;

  // Objeto social: de su título al siguiente encabezado. Sin cierre claro o muy corto, no se da por bueno.
  const purpose = sectionAfter(lines, /^objeto\s+social$/i);
  if (purpose && purpose.closed) {
    const paragraphs: string[] = [];
    for (const raw of purpose.body) {
      const line = raw.replace(/^objeto\s+social\s*:\s*/i, "").trim();
      if (!line || /^-{5,}$/.test(line)) continue;
      const bullet = /^(?:[A-Za-z]\)|\d{1,2}[.)]|[-•])\s+/.test(line);
      if (bullet || paragraphs.length === 0) paragraphs.push(line);
      else paragraphs[paragraphs.length - 1] += ` ${line}`;
    }
    const joined = paragraphs.join("\n");
    if (joined.length >= 25 && joined.length <= 8000) values.corporatePurpose = joined;
  }

  // Domicilio principal («MEDELLÍN, ANTIOQUIA, COLOMBIA»).
  const domicile = lines.map((l) => /^domicilio\s+principal\s*:\s*([^,]+),/i.exec(l)).find(Boolean);
  const domicileCity = domicile ? titleCase(domicile[1]) : "";

  if (values.registryChamber && values.constitutionDate && context.razonSocial) {
    const narrative = composeEntityNarrative({ name: titleCase(context.razonSocial), domicileCity, chamber: values.registryChamber, constitutionDate: values.constitutionDate, registryNumber: values.registryNumber ?? "", registryBook: values.registryBook ?? "" });
    if (narrative) values.entityNarrative = narrative;
  }

  for (const field of REGISTRAL_FIELDS) if (!values[field]) review.add(field);
  return { values, review: [...review] };
}
