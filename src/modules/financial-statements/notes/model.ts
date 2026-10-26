import type { Company } from "../../../types/models";
import { SECTION_LABEL, type FsCatalog, type FsLineRole, type FsSectionKey } from "../../../types/fs";
import { normalizeKey } from "../../../utils/text";
import { allocateCapital, subscribedCapitalPesos } from "../../exogena/domain/capital";
import type { Statements, StatementRow } from "../generator/engine";
import { roundThousands } from "../shared/money";
import { composeEntityNarrative } from "../../../pages/companies/import/registral";

/**
 * Notas Financieras — modelo puro.
 *
 * Las notas específicas son GRUPOS contables (Disponible, Propiedades planta y equipo, Pasivo corriente, …), no una nota por
 * partida. La lista se construye PRIMERO con los grupos que existen en los estados del período (los que tienen partidas visibles) y
 * luego se numera de 1 en adelante, en el orden de los estados, sin números reservados: un grupo que no existe no consume número.
 * El número se imprime una sola vez, en el encabezado del grupo en los estados (columna NOTA), y es el mismo en las notas y en el
 * PDF. Nada de esto cambia cifras ni clasificación: solo agrupa, presenta y ubica la nota.
 */

export type NoteSection = "esf" | "eerr";

export type NoteGroupId = "disponible" | "intangibles" | "deudores" | "ppe" | "liab_current" | "liab_noncurrent" | "capital" | "results" | "income" | "admin" | "sales" | "other_expenses";

/** Título de cada grupo (el PDF lo imprime en mayúsculas). */
export const NOTE_GROUP_TITLE: Record<NoteGroupId, string> = {
  disponible: "Disponible",
  intangibles: "Activos intangibles",
  deudores: "Deudores",
  ppe: "Propiedades, planta y equipo",
  liab_current: "Pasivo corriente",
  liab_noncurrent: "Pasivo no corriente",
  capital: "Capital social",
  results: "Resultados",
  income: "Ingresos de actividades ordinarias",
  admin: "Gastos operacionales de administración",
  sales: "Gastos operacionales de ventas",
  other_expenses: "Otros gastos",
};

/** Una fila clasificada de los estados: de qué sección y rol es y a qué grupo contribuye. */
interface Classified {
  index: number;
  row: StatementRow;
  section: FsSectionKey | undefined;
  role: FsLineRole | null | undefined;
}

const HEADER_SECTION = new Map<string, FsSectionKey>((Object.entries(SECTION_LABEL) as [FsSectionKey, string][]).map(([k, v]) => [v, k]));

/** Sección y rol de cada fila: los que trae la fila; si no (estados cerrados antiguos), el catálogo; si no, el encabezado anterior. */
function classify(rows: StatementRow[], catalog: FsCatalog | null | undefined): Classified[] {
  const byId = new Map((catalog?.lines ?? []).map((l) => [l.id, l]));
  let current: FsSectionKey | undefined;
  let pastOperating = false;
  return rows.map((row, index) => {
    if (row.kind === "header") {
      current = HEADER_SECTION.get(row.label) ?? current;
      return { index, row, section: current, role: undefined };
    }
    if (row.kind === "result" && row.label === "RESULTADO OPERACIONAL") pastOperating = true;
    if (row.kind !== "line") return { index, row, section: undefined, role: undefined };
    const line = row.lineId !== undefined ? byId.get(row.lineId) : undefined;
    let section = row.section ?? line?.section ?? current;
    // Los otros ingresos y gastos no tienen encabezado propio: en estados sin sección explícita se distinguen por su nombre.
    if (!row.section && !line && pastOperating) section = /ingreso/i.test(row.label) ? "other_income" : "other_expenses";
    return { index, row, section, role: row.role ?? line?.role };
  });
}

type Anchor = "header" | "first-line";
interface Membership {
  id: NoteGroupId;
  anchor: Anchor;
  /** Esta fila es parte de la nota (una partida con saldo o sin él). */
  member: boolean;
}

function membershipOf(c: Classified): Membership | null {
  const { row, section, role } = c;
  const name = normalizeKey(row.label);
  if (row.kind === "header") {
    const id = ({ liability_current: "liab_current", liability_noncurrent: "liab_noncurrent", income: "income", admin_expenses: "admin", sales_expenses: "sales" } as Partial<Record<FsSectionKey, NoteGroupId>>)[section!];
    return id ? { id, anchor: "header", member: false } : null;
  }
  if (row.kind !== "line") return null;
  switch (section) {
    case "asset_current":
      if (name === "disponible") return { id: "disponible", anchor: "first-line", member: true };
      if (name === "activos intangibles") return { id: "intangibles", anchor: "first-line", member: true };
      return name === "deudores" ? { id: "deudores", anchor: "first-line", member: true } : null;
    case "asset_noncurrent":
      if (name.startsWith("propiedad")) return { id: "ppe", anchor: "first-line", member: true };
      return name === "deudores" ? { id: "deudores", anchor: "first-line", member: true } : null;
    case "liability_current":
      return { id: "liab_current", anchor: "header", member: true };
    case "liability_noncurrent":
      return { id: "liab_noncurrent", anchor: "header", member: true };
    case "equity":
      if (role === "share_capital" || name === "capital social") return { id: "capital", anchor: "first-line", member: true };
      if (role === "period_result" || name.startsWith("resultado")) return { id: "results", anchor: "first-line", member: true };
      return null;
    case "income":
    case "other_income":
      return { id: "income", anchor: "header", member: true };
    case "admin_expenses":
      return { id: "admin", anchor: "header", member: true };
    case "sales_expenses":
      return { id: "sales", anchor: "header", member: true };
    case "other_expenses":
      return { id: "other_expenses", anchor: "first-line", member: true };
    default:
      return null;
  }
}

export interface NoteGroup {
  id: NoteGroupId;
  number: number;
  section: NoteSection;
  title: string;
  /** Posición de la fila principal que lleva el número en los estados (el encabezado del grupo o su primera partida). */
  anchor: { section: NoteSection; index: number };
  /** Todas las filas que muestran el número: el encabezado y las partidas que no cuelgan de él (Otros ingresos, ambos Otros gastos, ambos Resultados). */
  marks: number[];
  /** Filas de partida que forman la nota, en el orden de los estados. */
  lines: StatementRow[];
}

/**
 * Grupos que existen en los estados, numerados de forma consecutiva en el orden en que aparecen (ESF y luego ER). Un grupo existe
 * si tiene al menos una partida visible; los que no existen no reservan número.
 */
export function buildNoteGroups(esf: StatementRow[], eerr: StatementRow[], catalog?: FsCatalog | null): NoteGroup[] {
  const found = new Map<NoteGroupId, { section: NoteSection; headerIndex?: number; firstLineIndex?: number; anchor: Anchor; lines: StatementRow[]; loose: number[]; order: number }>();
  let order = 0;
  const scan = (section: NoteSection, rows: StatementRow[]) => {
    for (const c of classify(rows, catalog)) {
      const m = membershipOf(c);
      if (!m) continue;
      let g = found.get(m.id);
      if (!g) found.set(m.id, (g = { section, anchor: m.anchor, lines: [], loose: [], order: order++ }));
      if (c.row.kind === "header") g.headerIndex ??= c.index;
      else {
        g.firstLineIndex ??= c.index;
        // Deudores reúne corriente y no corriente en una sola nota: la nota discrimina cada parte.
        if (m.member) g.lines.push(m.id === "deudores" ? { ...c.row, label: c.section === "asset_noncurrent" ? "Deudores no corriente" : "Deudores corriente" } : c.row);
        // Sin encabezado propio (o fuera de él): la partida lleva el mismo número del grupo.
        if (m.member && (m.anchor === "first-line" || c.section === "other_income")) g.loose.push(c.index);
      }
    }
  };
  scan("esf", esf);
  scan("eerr", eerr);
  return [...found.entries()]
    .filter(([, g]) => g.lines.length > 0)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id, g], i) => ({
      id,
      number: i + 1,
      section: g.section,
      title: NOTE_GROUP_TITLE[id],
      anchor: { section: g.section, index: (g.anchor === "header" ? g.headerIndex : undefined) ?? g.firstLineIndex! },
      marks: [...new Set([...(g.anchor === "header" && g.headerIndex !== undefined ? [g.headerIndex] : []), ...g.loose])],
      lines: g.lines,
    }));
}

/** Copia de las filas con el número de cada grupo en su encabezado (y en las partidas sin encabezado propio): columna NOTA de los estados y del PDF. */
export function withNoteNumbers(esf: StatementRow[], eerr: StatementRow[], catalog?: FsCatalog | null): { esf: StatementRow[]; eerr: StatementRow[] } {
  const groups = buildNoteGroups(esf, eerr, catalog);
  const apply = (section: NoteSection, rows: StatementRow[]) => rows.map((row, i) => ({ ...row, note: groups.find((g) => g.section === section && g.marks.includes(i))?.number }));
  return { esf: apply("esf", esf), eerr: apply("eerr", eerr) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Contenido de cada nota
// ---------------------------------------------------------------------------------------------------------------------

export interface NoteTableRow {
  label: string;
  /** Sin valor: fila de subtítulo. */
  pesos?: number;
  indent?: boolean;
}

export interface CapitalRow {
  number: number;
  name: string;
  nominalValue: number;
  shares: number;
  total: number;
}

export interface CapitalTable {
  rows: CapitalRow[];
  totalShares: number;
  total: number;
}

export type NoteBody =
  | { kind: "table"; rows: NoteTableRow[] }
  | { kind: "capital"; table: CapitalTable | null }
  /** Sin saldos en el período: se imprime el texto aprobado, nunca una tabla vacía ni ceros. */
  | { kind: "empty" };

export interface NoteItem {
  /** Clave estable del grupo (no cambia aunque cambie el número). */
  key: string;
  id: NoteGroupId;
  number: number;
  section: NoteSection;
  title: string;
  /** Total del grupo en pesos al millar, tal como suman las partidas de los estados. */
  pesos: number;
  body: NoteBody;
  /** Partidas del catálogo que forman la nota (para migrar ediciones antiguas por partida). */
  lineIds: number[];
}

export const NO_BALANCES_TEXT = "Durante el período no se registraron saldos en esta partida.";

export const noteKey = (id: NoteGroupId) => `group:${id}`;

/** «CAJA» → «Caja»; conserva las siglas y las partículas en minúscula. */
export function sentenceCase(text: string): string {
  const t = text.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Reparte `pesos` (el valor ya redondeado de la partida en el estado) entre sus componentes exactos, en pesos al millar, de modo que
 * la suma de la nota sea exactamente la del estado: cada uno se redondea y la diferencia queda en el de mayor valor absoluto.
 */
export function allocateToPesos(centsList: number[], pesos: number): number[] {
  const rounded = centsList.map(roundThousands);
  const diff = pesos - rounded.reduce((a, b) => a + b, 0);
  if (diff !== 0 && rounded.length > 0) {
    let top = 0;
    rounded.forEach((v, i) => {
      if (Math.abs(v) > Math.abs(rounded[top])) top = i;
    });
    rounded[top] += diff;
  }
  return rounded;
}

export interface NoteSources {
  catalog?: FsCatalog | null;
  /** Estados calculados: de ellos salen el desglose del Disponible y los resultados por año. */
  statements?: Pick<Statements, "sections"> | null;
  /** Concepto de cada código PUC (nombres de las cuentas principales). */
  pucConcepts?: Map<string, string>;
  company?: Pick<Company, "subscribedTotalShares" | "subscribedNominalValue" | "shareholders"> | null;
}

/** Tabla del capital social con los datos del perfil de la empresa; null si el capital no está configurado. */
export function capitalTable(company: Pick<Company, "subscribedTotalShares" | "subscribedNominalValue" | "shareholders">): CapitalTable | null {
  const total = subscribedCapitalPesos(company);
  const nominal = company.subscribedNominalValue;
  const totalShares = company.subscribedTotalShares;
  if (total === null || !nominal || !totalShares) return null;
  const holders = [...company.shareholders].filter((s) => s.name.trim()).sort((a, b) => a.sortOrder - b.sortOrder);
  if (holders.length === 0) return null;
  const shares = allocateCapital(totalShares, holders);
  const rows = holders.map((h, i) => ({ number: i + 1, name: h.name.trim(), nominalValue: nominal, shares: shares[i], total: shares[i] * nominal }));
  return { rows, totalShares: rows.reduce((a, r) => a + r.shares, 0), total: rows.reduce((a, r) => a + r.total, 0) };
}

const lineValues = (statements: NoteSources["statements"]) => {
  const map = new Map<number, Statements["sections"][FsSectionKey]["lines"][number]>();
  if (statements) for (const section of Object.values(statements.sections)) for (const v of section.lines) map.set(v.line.id, v);
  return map;
};

function bodyOf(group: NoteGroup, src: NoteSources, values: ReturnType<typeof lineValues>): NoteBody {
  const own = group.lines.filter((r) => (r.pesos ?? 0) !== 0);
  if (group.id === "capital") return { kind: "capital", table: src.company ? capitalTable(src.company) : null };
  if (own.length === 0) return { kind: "empty" };

  if (group.id === "disponible") {
    // Cuentas principales (4 dígitos): Caja, Bancos, …, con su nombre del PUC, no el código.
    const rows: NoteTableRow[] = [];
    for (const line of own) {
      const v = line.lineId !== undefined ? values.get(line.lineId) : undefined;
      const byAccount = new Map<string, { name: string; cents: number }>();
      for (const c of v?.contributions ?? []) {
        const account = c.pucCode.slice(0, 4);
        const entry = byAccount.get(account) ?? { name: src.pucConcepts?.get(account) || c.concept || line.label, cents: 0 };
        entry.cents += c.cents;
        byAccount.set(account, entry);
      }
      if (byAccount.size === 0) rows.push({ label: line.label, pesos: line.pesos });
      else {
        const accounts = [...byAccount.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
        const pesos = allocateToPesos(accounts.map(([, a]) => a.cents), line.pesos ?? 0);
        accounts.forEach(([, a], i) => pesos[i] !== 0 && rows.push({ label: sentenceCase(a.name), pesos: pesos[i] }));
      }
    }
    return rows.length ? { kind: "table", rows } : { kind: "empty" };
  }

  if (group.id === "results") {
    const rows: NoteTableRow[] = [];
    for (const line of own) {
      const prior = normalizeKey(line.label).includes("anterior");
      const v = line.lineId !== undefined ? values.get(line.lineId) : undefined;
      if (!prior || !v || v.byYear.length === 0) {
        rows.push({ label: line.label, pesos: line.pesos });
        continue;
      }
      const pesos = allocateToPesos(v.byYear.map((y) => y.cents), line.pesos ?? 0);
      const years = v.byYear.map((y, i) => ({ label: y.year || "Sin fecha", pesos: pesos[i] })).filter((y) => y.pesos !== 0);
      if (years.length === 0 || (years.length === 1 && !/^\d{4}$/.test(years[0].label))) rows.push({ label: line.label, pesos: line.pesos });
      else for (const y of years) rows.push({ label: `${line.label} — ${y.label}`, pesos: y.pesos });
    }
    return { kind: "table", rows };
  }

  return { kind: "table", rows: own.map((r) => ({ label: r.label, pesos: r.pesos })) };
}

/** Notas específicas: los grupos de los estados con su contenido, numerados consecutivamente. */
export function buildNoteItems(esf: StatementRow[], eerr: StatementRow[], src: NoteSources = {}): NoteItem[] {
  const values = lineValues(src.statements);
  return buildNoteGroups(esf, eerr, src.catalog).map((g) => ({
    key: noteKey(g.id),
    id: g.id,
    number: g.number,
    section: g.section,
    title: g.title,
    pesos: g.lines.reduce((a, r) => a + (r.pesos ?? 0), 0),
    body: bodyOf(g, src, values),
    lineIds: g.lines.flatMap((r) => (r.lineId === undefined ? [] : [r.lineId])),
  }));
}

/** Total que muestra la tabla de una nota (suma de sus filas con valor). */
export const noteTableTotal = (rows: NoteTableRow[]) => rows.reduce((a, r) => a + (r.pesos ?? 0), 0);

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

/**
 * Pasa las ediciones guardadas por partida (`esf:12`, `eerr:30`, de cuando cada partida tenía su nota) a la nota del grupo al que
 * hoy pertenece esa partida: los párrafos se conservan, uno tras otro. No toca las ediciones que ya son de grupo.
 */
export function migrateEdits(data: NotesData, items: NoteItem[]): NotesData {
  const legacy = Object.keys(data.notes).filter((k) => /^(esf|eerr):/.test(k));
  if (legacy.length === 0) return data;
  const notes: Record<string, NoteEdit> = Object.fromEntries(Object.entries(data.notes).filter(([k]) => !legacy.includes(k)));
  for (const k of legacy) {
    const lineId = Number(k.replace(/^(esf|eerr):/, "").replace(/^r/, "-"));
    const target = items.find((i) => i.lineIds.includes(lineId));
    if (!target) continue;
    const merged = [...(notes[target.key]?.paragraphs ?? []), ...data.notes[k].paragraphs.filter((p) => p.trim())];
    notes[target.key] = { paragraphs: merged };
  }
  return { ...data, notes };
}

/** Quita las ediciones de notas que ya no existen en los estados (por ejemplo un grupo que dejó de aparecer). */
export function pruneEdits(data: NotesData, items: NoteItem[]): NotesData {
  const migrated = migrateEdits(data, items);
  const keys = new Set(items.map((i) => i.key));
  const notes = Object.fromEntries(Object.entries(migrated.notes).filter(([k]) => keys.has(k)));
  return Object.keys(notes).length === Object.keys(migrated.notes).length && migrated === data ? data : { ...migrated, notes };
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
