import { digitsOf, nameKey, samePerson } from "../normalize";
import type { LegalRole, Shareholder } from "../../../types/models";
import type { CamaraData, PersonRef } from "./camaraParser";
import type { RutData } from "./rutParser";
import type { ImportSource } from "./importPlan";

/** Representación legal tal como la maneja el formulario. */
export interface RepFormState {
  shareholders: Pick<Shareholder, "name" | "identityDocument" | "legalRole">[];
  legalRepName: string;
  legalRepDocument: string;
  legalRepManual: boolean;
  legalRepAltName: string;
  legalRepAltDocument: string;
  legalRepAltManual: boolean;
}

export interface Person {
  name: string;
  /** «CC 1020713259» (tipo + número) o solo número. */
  document: string;
}

export const personFromRef = (p: PersonRef): Person => ({ name: p.name, document: p.documentType && p.documentNumber ? `${p.documentType} ${p.documentNumber}` : p.documentNumber });

/** La persona hoy seleccionada como principal o suplente: un socio vinculado o la excepción confirmada. */
export function selectedRep(form: RepFormState, role: LegalRole): (Person & { kind: "shareholder" | "manual" }) | null {
  const linked = form.shareholders.find((s) => s.legalRole === role);
  if (linked) return { name: linked.name, document: linked.identityDocument, kind: "shareholder" };
  const name = role === "principal" ? form.legalRepName : form.legalRepAltName;
  const document = role === "principal" ? form.legalRepDocument : form.legalRepAltDocument;
  if (!name.trim() && !document.trim()) return null;
  return { name, document, kind: "manual" };
}

/** Índice del socio que es esta persona (por documento si ambos lo tienen; si no, por nombre). */
export function findShareholder(shareholders: RepFormState["shareholders"], person: Person): number {
  return shareholders.findIndex((s) => samePerson({ name: s.name, document: s.identityDocument }, person));
}

export interface RepOption {
  source: ImportSource;
  person: Person;
  cargo: string;
}

export interface RepProposal {
  role: LegalRole;
  options: RepOption[];
  /** El RUT y la Cámara nombran personas distintas para este cargo: hay que elegir. */
  conflict: boolean;
  /** Un mismo documento nombra a varias personas para este cargo (p. ej. gerente y representante legal): hay que elegir. */
  ambiguous: boolean;
}

function optionsFor(role: LegalRole, rut: RutData | null, camara: CamaraData | null): RepOption[] {
  const out: RepOption[] = [];
  for (const p of rut?.representatives ?? []) {
    if (p.isAlternate === (role === "alternate")) out.push({ source: "rut", cargo: p.role, person: personFromRef({ name: p.name, documentType: p.documentType, documentNumber: p.documentNumber, cargo: p.role }) });
  }
  for (const p of (role === "principal" ? camara?.principals : camara?.alternates) ?? []) out.push({ source: "camara", cargo: p.cargo, person: personFromRef(p) });
  return out;
}

/** Quién propone cada documento para principal y suplente, y si coinciden. */
export function planRepresentatives(rut: RutData | null, camara: CamaraData | null): RepProposal[] {
  return (["principal", "alternate"] as LegalRole[])
    .map((role) => {
      const options = optionsFor(role, rut, camara);
      const perSource = (s: ImportSource) => options.filter((o) => o.source === s);
      const ambiguous = perSource("rut").length > 1 || perSource("camara").length > 1;
      const first = options[0];
      const conflict = !!first && options.some((o) => !samePerson(first.person, o.person));
      return { role, options, conflict, ambiguous };
    })
    .filter((p) => p.options.length > 0);
}

export interface RepWarning {
  role: LegalRole;
  /** La persona que indica la Cámara de Comercio. */
  expected: Person;
  /** Lo seleccionado hoy (null = nadie). */
  selected: Person | null;
}

/**
 * Avisos que no se ocultan: los representantes que nombra la Cámara no coinciden con los seleccionados.
 * Se comparan por documento (cuando ambos lo tienen) y por nombre normalizado (mayúsculas, tildes, espacios, orden).
 */
export function camaraRepWarnings(form: RepFormState, camara: CamaraData | null): RepWarning[] {
  if (!camara) return [];
  const out: RepWarning[] = [];
  for (const role of ["principal", "alternate"] as LegalRole[]) {
    const named = (role === "principal" ? camara.principals : camara.alternates).map(personFromRef);
    if (!named.length) continue;
    const selected = selectedRep(form, role);
    const matches = selected && named.some((p) => samePerson(p, selected));
    if (!matches) out.push({ role, expected: named[0], selected: selected ? { name: selected.name, document: selected.document } : null });
  }
  return out;
}

/** Marca como representante a un socio (y quita el rol a quien lo tenía). `index` null = sin selección. */
export function assignRole<T extends { legalRole?: LegalRole | null }>(shareholders: T[], role: LegalRole, index: number | null): T[] {
  return shareholders.map((s, i) => {
    if (i === index) return { ...s, legalRole: role };
    return s.legalRole === role ? { ...s, legalRole: null } : s;
  });
}

export { digitsOf, nameKey };
