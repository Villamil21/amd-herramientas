import type { Company } from "../../../types/models";
import type { StatementRow } from "../generator/engine";
import { composeEntityNarrative } from "../../../pages/companies/import/registral";

/**
 * Notas Financieras — modelo puro.
 *
 * Las notas específicas salen de las partidas (filas «line») que REALMENTE aparecen en el Estado de Situación Financiera y en el
 * Estado de Resultados, en su orden de aparición: primero el ESF, luego el ER. Una partida visible con saldo $0 conserva su
 * nota; una partida que no aparece no tiene nota; encabezados, subtotales, totales y resultados nunca llevan nota. El número
 * de la nota es el mismo que se imprime en la columna NOTA de los estados.
 */

export type NoteSection = "esf" | "eerr";

export interface NoteItem {
  /** Clave estable: la línea del catálogo (no cambia aunque cambie el número). */
  key: string;
  number: number;
  section: NoteSection;
  title: string;
  /** Saldo en pesos al millar, tal como aparece en el estado. */
  pesos: number;
}

const keyOf = (section: NoteSection, row: StatementRow, index: number) => `${section}:${row.lineId ?? `r${index}`}`;

/** Notas específicas de los estados, numeradas por orden de aparición. */
export function buildNoteItems(esf: StatementRow[], eerr: StatementRow[]): NoteItem[] {
  const items: NoteItem[] = [];
  const add = (section: NoteSection, rows: StatementRow[]) =>
    rows.forEach((row, i) => {
      if (row.kind !== "line") return;
      items.push({ key: keyOf(section, row, i), number: items.length + 1, section, title: row.label, pesos: row.pesos ?? 0 });
    });
  add("esf", esf);
  add("eerr", eerr);
  return items;
}

/** Copia de las filas con el número de nota en cada partida (columna NOTA de los estados y del PDF). */
export function withNoteNumbers(esf: StatementRow[], eerr: StatementRow[]): { esf: StatementRow[]; eerr: StatementRow[] } {
  const numbers = new Map(buildNoteItems(esf, eerr).map((n) => [n.key, n.number]));
  const apply = (section: NoteSection, rows: StatementRow[]) => rows.map((row, i) => (row.kind === "line" ? { ...row, note: numbers.get(keyOf(section, row, i)) } : { ...row, note: undefined }));
  return { esf: apply("esf", esf), eerr: apply("eerr", eerr) };
}

/** Texto editable de una nota: párrafos de detalle que el usuario agrega, edita o quita. */
export interface NoteEdit {
  paragraphs: string[];
}

/** Lo que se guarda por empresa y período. */
export interface NotesData {
  version: 1;
  periodStart: string;
  periodEnd: string;
  /** Presentación interna con la que se numeraron las notas (no se imprime). */
  presentation: string;
  entityNarrative: string;
  corporatePurpose: string;
  /** Datos de Empresas que quedaron dudosos («Revisar») al tomarlos: se muestran hasta que el usuario los confirma. */
  review: ("entityNarrative" | "corporatePurpose")[];
  /** Ediciones por clave de nota. */
  notes: Record<string, NoteEdit>;
}

/** Instantánea de los datos de Empresas con los que se generaron las notas (para reproducir un PDF histórico). */
export interface CompanySnapshot {
  companyId: number;
  takenAt: string;
  razonSocial: string;
  nit: string;
  dv: string;
  ciudad: string;
  logoFile: string | null;
  legalRepName: string;
  legalRepDocument: string;
  entityNarrative: string;
  corporatePurpose: string;
  registryChamber: string;
  registryCity: string;
  constitutionDocType: string;
  constitutionDate: string;
  registryNumber: string;
  registryDate: string;
  registryBook: string;
  registralReview: string[];
}

export function companySnapshot(c: Company, takenAt = new Date().toISOString()): CompanySnapshot {
  return {
    companyId: c.id,
    takenAt,
    razonSocial: c.razonSocial,
    nit: c.nit,
    dv: c.dv,
    ciudad: c.ciudad,
    logoFile: c.logoFile,
    legalRepName: c.legalRepName,
    legalRepDocument: c.legalRepDocument,
    entityNarrative: c.entityNarrative,
    corporatePurpose: c.corporatePurpose,
    registryChamber: c.registryChamber,
    registryCity: c.registryCity,
    constitutionDocType: c.constitutionDocType,
    constitutionDate: c.constitutionDate,
    registryNumber: c.registryNumber,
    registryDate: c.registryDate,
    registryBook: c.registryBook,
    registralReview: c.registralReview,
  };
}

/** «Está representada por …» al final del ente económico (solo si el texto de Empresas no lo trae). */
export function entityText(snap: Pick<CompanySnapshot, "razonSocial" | "ciudad" | "entityNarrative" | "registryChamber" | "constitutionDate" | "registryNumber" | "registryBook" | "legalRepName">): string {
  const base = snap.entityNarrative.trim() || composeEntityNarrative({ name: snap.razonSocial, domicileCity: snap.ciudad, chamber: snap.registryChamber, constitutionDate: snap.constitutionDate, registryNumber: snap.registryNumber, registryBook: snap.registryBook });
  if (!base) return "";
  const clean = base.replace(/[.\s]+$/, "");
  if (!snap.legalRepName.trim() || /representad[ao]/i.test(clean)) return `${clean}.`;
  return `${clean}, está representada por ${titleName(snap.legalRepName)}.`;
}

/** «JONATHAN EUTIMIO MÁRQUEZ HERNÁNDEZ» → «Jonathan Eutimio Márquez Hernández». */
export const titleName = (name: string) => name.toLowerCase().replace(/(^|\s)(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase());

/** Borrador inicial: textos de Empresas y «Revisar» donde Empresas no los tiene con certeza. */
export function initialNotesData(snap: CompanySnapshot, period: { start: string; end: string }, presentation: string): NotesData {
  const entity = entityText(snap);
  const review: NotesData["review"] = [];
  if (!entity || snap.registralReview.includes("entityNarrative")) review.push("entityNarrative");
  if (!snap.corporatePurpose.trim() || snap.registralReview.includes("corporatePurpose")) review.push("corporatePurpose");
  return { version: 1, periodStart: period.start, periodEnd: period.end, presentation, entityNarrative: entity, corporatePurpose: snap.corporatePurpose.trim(), review, notes: {} };
}

/** Quita las ediciones de notas que ya no existen en los estados (por ejemplo una partida que dejó de aparecer). */
export function pruneEdits(data: NotesData, items: NoteItem[]): NotesData {
  const keys = new Set(items.map((i) => i.key));
  const notes = Object.fromEntries(Object.entries(data.notes).filter(([k]) => keys.has(k)));
  return Object.keys(notes).length === Object.keys(data.notes).length ? data : { ...data, notes };
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const longDate = (iso: string, upper = false) => {
  const text = `${iso.slice(8, 10)} de ${cap(MONTHS[Number(iso.slice(5, 7)) - 1])} de ${iso.slice(0, 4)}`;
  return upper ? text.toUpperCase() : text;
};
export { longDate };

/** «DE 01 ENERO A 31 AGOSTO DE 2026» (encabezado de cada página). */
export function headerPeriod(start: string, end: string): string {
  const m = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1].toUpperCase();
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `DE ${start.slice(8, 10)} ${m(start)}${sameYear ? "" : ` ${start.slice(0, 4)}`} A ${end.slice(8, 10)} ${m(end)} DE ${end.slice(0, 4)}`;
}

/** Párrafo de «Periodo cubierto por los estados financieros» con las fechas del período. */
export const periodParagraph = (start: string, end: string) =>
  `Estos estados financieros comprenden el estado de situación financiera al ${longDate(end)} así como el estado de resultados correspondiente al período comprendido entre ${longDate(start)} y ${longDate(end)}.`;
