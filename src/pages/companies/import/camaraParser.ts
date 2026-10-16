import type { PdfDocumentText } from "../../../modules/bank-analysis/shared/pdf/pdfTypes";
import { joinPages, pageLines, parseWholeNumber } from "./lines";

export interface CapitalData {
  /** Cantidad de acciones y valor nominal. El valor total no se extrae: siempre es acciones × valor nominal. */
  shares: number | null;
  nominal: number | null;
}

export interface PersonRef {
  name: string;
  documentType: string;
  /** Solo dígitos. */
  documentNumber: string;
  /** Cargo tal como lo escribe el certificado. */
  cargo: string;
}

export interface CamaraData {
  razonSocial?: string;
  nit?: string;
  dv?: string;
  expeditionDate?: string;
  subscribed: CapitalData;
  paid: CapitalData;
  /** Representantes legales nombrados (no incluye junta directiva ni revisores fiscales). */
  principals: PersonRef[];
  alternates: PersonRef[];
  /** Qué no se pudo leer de forma confiable, en palabras para el usuario. */
  notes: string[];
}

const CAPITAL_HEADS = {
  authorized: /^[*\s]*capital\s+autorizado(?:\s*\/\s*\w+)?\s*[*:]*\s*(.*)$/i,
  subscribed: /^[*\s]*capital\s+suscrito(?:\s*\/\s*\w+)?\s*[*:]*\s*(.*)$/i,
  paid: /^[*\s]*capital\s+pagado\s*[*:]*\s*(.*)$/i,
} as const;
/** Lo que puede acompañar a un rótulo de capital en su misma línea; una oración completa no es un rótulo. */
const HEAD_REST = /^[\s$\d.,:*-]*$|^(?:valor|no\.?|n[uú]mero|cantidad|acciones|nominal|de|cuotas|[\s$\d.,:*-])+$/i;

function headKind(line: string): keyof typeof CAPITAL_HEADS | null {
  for (const [kind, re] of Object.entries(CAPITAL_HEADS) as [keyof typeof CAPITAL_HEADS, RegExp][]) {
    const m = re.exec(line);
    if (m && HEAD_REST.test(m[1])) return kind;
  }
  return null;
}

const SECTION_END = /^(?:[ÓO]RGANOS DE ADMINISTRACI|REPRESENTACI[ÓO]N LEGAL|NOMBRAMIENTO|REFORMAS|FACULTADES|JUNTA DIRECTIVA)/i;
const UNITS = "(?:acciones|cuotas|partes\\s+de\\s+inter[eé]s|participaciones)";
const SHARES = new RegExp(`(?:\\bn[uú]mero|\\bcantidad|\\bno\\.?)\\s*(?:de\\s+)?${UNITS}\\s*:?\\s*\\$?\\s*([\\d][\\d.,]*)`, "i");
const NOMINAL = new RegExp(`valor\\s+nominal(?:\\s+(?:de\\s+)?(?:las\\s+|cada\\s+)?${UNITS}|\\s+por\\s+acci[oó]n)?\\s*:?\\s*\\$?\\s*([\\d][\\d.,]*)`, "i");
const TOTAL = /(?:^|\s)valor\s*:?\s*\$\s*([\d][\d.,]*)(?!\s*nominal)/i;

function readCapital(lines: string[], start: number, label: string, notes: string[]): CapitalData {
  const block: string[] = [];
  for (let i = start; i < lines.length && block.length < 14; i++) {
    if (i > start && (headKind(lines[i]) || SECTION_END.test(lines[i]))) break;
    block.push(lines[i]);
  }
  const text = block.join(" ");
  const sharesRaw = SHARES.exec(text)?.[1];
  const nominalRaw = NOMINAL.exec(text)?.[1];
  const totalRaw = TOTAL.exec(text)?.[1];
  const shares = sharesRaw ? parseWholeNumber(sharesRaw) : null;
  const nominal = nominalRaw ? parseWholeNumber(nominalRaw) : null;
  if (!shares || !nominal) {
    notes.push(`${label}: no se pudo leer ${!shares && !nominal ? "la cantidad de acciones ni el valor nominal" : !shares ? "la cantidad de acciones" : "el valor nominal"} con seguridad.`);
    return { shares: shares ?? null, nominal: nominal ?? null };
  }
  const total = totalRaw ? parseWholeNumber(totalRaw) : null;
  if (total && total !== shares * nominal) {
    notes.push(`${label}: el certificado indica un valor total distinto a acciones × valor nominal; revisa los datos.`);
    return { shares: null, nominal: null };
  }
  return { shares, nominal };
}

const DOC_TYPES: Record<string, string> = { CC: "CC", CE: "CE", NIT: "NIT", PP: "PP", PA: "PA", PAS: "PA", PASAPORTE: "PA", TI: "TI", PEP: "PEP", PPT: "PPT" };
const ID = /\b(C\.?\s?C\.?|C\.?\s?E\.?|N\.?I\.?T\.?|P\.?\s?P\.?|PASAPORTE|T\.?\s?I\.?|P\.?E\.?P\.?|P\.?P\.?T\.?)\s*(?:No\.?|N[uú]mero)?\s*:?\s*(\d[\d.\s]*\d|\d)/i;
const REP_TAIL = "(?:\\s+(?:y|e)\\s+representante(?:\\s+legal)?(?:\\s+suplente)?)?";
const CARGO_WORDS = new RegExp(
  "^(?:representante(?:s)?\\s+legal(?:es)?(?:\\s+(?:principal|suplente|judicial|1|2|primero|segundo))?" +
    "|(?:gerente(?:\\s+general)?(?:\\s+suplente)?|subgerente|presidente(?:\\s+(?:suplente|ejecutivo))?|administrador(?:\\s+(?:principal|suplente))?|director(?:\\s+general)?|apoderado(?:\\s+general)?)" + REP_TAIL +
    "|suplente(?:\\s+del\\s+(?:gerente(?:\\s+general)?|representante\\s+legal))?|liquidador|agente\\s+(?:especial|interventor)|rep\\.?\\s*legal(?:\\s+suplente)?)\\b",
  "i",
);

const LEGAL_SECTION = /^(?:nombramientos?\s*)?(?:\(s\)\s*)?(?:representantes?\s+legales?|nombramiento\(?s?\)?\s+representaci[oó]n\s+legal)\s*$/i;
const LEGAL_SECTION_2 = /^nombramiento\(?s?\)?\s+representaci[oó]n\s+legal\b/i;
const OTHER_SECTION = /^(?:junta\s+directiva|revisor(?:es)?\s+fiscal(?:es)?|reformas|recursos|situaciones|facultades|funciones|objeto|capital|t[eé]rmino|constituci[oó]n|certifica|matr[ií]cula|ubicaci[oó]n|[oó]rganos de administraci|informaci[oó]n|establecimientos|actividad|informaci[oó]n complementaria|nombre,|c e r t i f i c a)/i;

function cleanDocumentType(raw: string): string {
  return DOC_TYPES[raw.replace(/[.\s]/g, "").toUpperCase()] ?? raw.replace(/[.\s]/g, "").toUpperCase();
}

/** Representantes de la sección «Representantes legales / Nombramiento(s) representación legal». */
function readRepresentatives(lines: string[]): PersonRef[] {
  const people: PersonRef[] = [];
  let inLegal = false;
  let pendingCargo = "";
  for (const [index, line] of lines.entries()) {
    if (LEGAL_SECTION.test(line) || LEGAL_SECTION_2.test(line)) {
      inLegal = true;
      pendingCargo = "";
      continue;
    }
    if (OTHER_SECTION.test(line) && !/^nombramiento/i.test(line)) {
      inLegal = false;
      continue;
    }
    if (/^nombramientos?$/i.test(line)) continue;
    if (!inLegal) continue;
    const id = ID.exec(line);
    if (!id) {
      // «Representante Legal» solo en una línea y el nombre en la siguiente.
      const cargoOnly = CARGO_WORDS.exec(line);
      pendingCargo = cargoOnly && cargoOnly[0].length === line.length ? line : "";
      continue;
    }
    let before = line.slice(0, id.index).trim();
    let cargo = pendingCargo;
    const cargoAtStart = CARGO_WORDS.exec(before);
    if (cargoAtStart) {
      cargo = cargoAtStart[0];
      before = before.slice(cargoAtStart[0].length).trim();
    }
    pendingCargo = "";
    // El cargo puede continuar en la línea siguiente («GERENTE Y REPRESENTANTE» / «LEGAL SUPLENTE»).
    const continuation = /^(?:legal\s+)?(?:suplente|principal)\s*$|^legal\s*$/i.exec(lines[index + 1] ?? "");
    if (continuation) cargo = `${cargo} ${continuation[0].trim()}`;
    const name = before.replace(/^[-–:]+/, "").trim();
    // Sin nombre claro o sin cargo reconocible no se inventa: la fila de revisores, apoderados, etc. no entra.
    if (name.length < 3 || !cargo || /fiscal/i.test(cargo)) continue;
    people.push({ name, documentType: cleanDocumentType(id[1]), documentNumber: id[2].replace(/\D/g, ""), cargo });
  }
  return people;
}

const isAlternate = (cargo: string) => /suplente/i.test(cargo);

export function parseCamara(doc: PdfDocumentText): CamaraData {
  const pages = pageLines(doc);
  const lines = joinPages(pages);
  const notes: string[] = [];
  const head = (pages[0] ?? []).slice(0, 60).join(" ");
  if (!/c[aá]mara de comercio|certificado de existencia/i.test(head)) {
    notes.push("El PDF no parece un certificado de existencia y representación legal de una Cámara de Comercio.");
  }

  const heads = lines.map((l, i) => ({ kind: headKind(l), i })).filter((h): h is { kind: keyof typeof CAPITAL_HEADS; i: number } => h.kind !== null);
  const at = (kind: keyof typeof CAPITAL_HEADS) => heads.find((h) => h.kind === kind)?.i;
  const subscribedAt = at("subscribed");
  const paidAt = at("paid");
  const subscribed = subscribedAt === undefined ? { shares: null, nominal: null } : readCapital(lines, subscribedAt, "Capital suscrito", notes);
  const paid = paidAt === undefined ? { shares: null, nominal: null } : readCapital(lines, paidAt, "Capital pagado", notes);
  if (subscribedAt === undefined) notes.push("No se encontró la sección de capital suscrito.");
  if (paidAt === undefined) notes.push("No se encontró la sección de capital pagado.");

  const people = readRepresentatives(lines);
  if (!people.length) notes.push("No se encontraron representantes legales nombrados.");

  const razonIndex = lines.findIndex((l) => /^raz[oó]n\s+social\s*:?/i.test(l));
  let razonSocial: string | undefined;
  if (razonIndex >= 0) {
    const inline = lines[razonIndex].replace(/^raz[oó]n\s+social\s*:?\s*/i, "").trim();
    const next = lines[razonIndex + 1] ?? "";
    razonSocial = inline || (/^(?:sigla|nit|identificaci|domicilio|matr)/i.test(next) ? undefined : next) || undefined;
  }
  // «Nit : 901679752-3», «Nit: 901.709.572 - 4» y «Nit: 901849928 2 Administración…» (el DV sigue al número).
  const nitMatch = lines
    .slice(0, 80)
    .map((l) => /^n\.?i\.?t\.?\s*(?:no\.?)?\s*:?\s*(\d[\d.]{4,}\d)\s*(?:-\s*)?(\d)?(?!\d)/i.exec(l))
    .find(Boolean);
  const expedition = /fecha\s+(?:de\s+)?expedici[oó]n\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec((pages[0] ?? []).join("\n"));

  return {
    razonSocial,
    nit: nitMatch ? nitMatch[1].replace(/\D/g, "") : undefined,
    dv: nitMatch?.[2],
    expeditionDate: expedition ? `${expedition[3]}-${expedition[2]}-${expedition[1]}` : undefined,
    subscribed,
    paid,
    principals: people.filter((p) => !isAlternate(p.cargo)),
    alternates: people.filter((p) => isAlternate(p.cargo)),
    notes,
  };
}
