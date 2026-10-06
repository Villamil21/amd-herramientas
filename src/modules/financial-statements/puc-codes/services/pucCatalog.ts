import type { PucCode } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";

/**
 * Catálogo PUC en memoria: índice por código, búsqueda de códigos asignables
 * y filas para mostrarlo con su jerarquía.
 *
 * Niveles: clase (1 dígito) → grupo (2) → cuenta (4) → subcuenta (6). Solo la
 * subcuenta de 6 dígitos se puede asignar a una factura o producto; los demás
 * niveles organizan y dan contexto.
 */

export type PucLevel = "class" | "group" | "account" | "leaf";

const LEVEL: Record<number, PucLevel> = { 1: "class", 2: "group", 4: "account", 6: "leaf" };

export const levelOf = (code: string): PucLevel | undefined => LEVEL[code.length];

/** Código final asignable: exactamente 6 dígitos. */
export const isSelectableCode = (code: string) => /^\d{6}$/.test(code);

/** Subcuenta con el texto ya normalizado para buscar. */
interface Leaf extends PucCode {
  key: string;
  /** Denominación normalizada de su cuenta de 4 dígitos (contexto de búsqueda). */
  accountKey: string;
}

export interface PucIndex {
  /** Todo el catálogo, en el orden del PUC. */
  all: PucCode[];
  /** Código (cualquier nivel) → concepto. */
  concepts: Map<string, string>;
  leaves: Leaf[];
}

export function buildPucIndex(codes: PucCode[]): PucIndex {
  // Como texto, el orden es el del catálogo: «1» < «11» < «1105» < «110505» < «1110».
  const all = codes.filter((c) => levelOf(c.code)).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const concepts = new Map(all.map((c) => [c.code, c.concept]));
  const leaves = all.filter((c) => isSelectableCode(c.code)).map((c) => ({ ...c, key: normalizeKey(c.concept), accountKey: normalizeKey(concepts.get(c.code.slice(0, 4)) ?? "") }));
  return { all, concepts, leaves };
}

/** Concepto de un código asignable; undefined si no existe o no es de 6 dígitos. */
export function leafConcept(index: PucIndex, code: string | undefined): string | undefined {
  return code && isSelectableCode(code) ? index.concepts.get(code) : undefined;
}

/** «1105 CAJA · DISPONIBLE»: la cuenta y el grupo de una subcuenta, si están en el catálogo. */
export function leafContext(index: PucIndex, code: string): string {
  const account = index.concepts.get(code.slice(0, 4));
  const group = index.concepts.get(code.slice(0, 2));
  return [account && `${code.slice(0, 4)} ${account}`, group].filter(Boolean).join(" · ");
}

const plain = ({ code, concept }: PucCode): PucCode => ({ code, concept });

export interface LeafSearch {
  /** Códigos de 6 dígitos que coinciden, hasta `limit`. */
  results: PucCode[];
  /** Coincidencias totales (puede superar `limit`). */
  total: number;
  /** La consulta es exactamente un código de 6 dígitos del catálogo. */
  exact?: PucCode;
  /** Explicación cuando no hay resultados (ej. cuenta sin subcuentas explícitas). */
  note?: string;
}

/**
 * Busca códigos asignables por código (completo o parte) o por concepto.
 *
 * - Solo dígitos: se trata como prefijo («1105» → 110505, 110510…; nunca la
 *   cuenta «1105 — CAJA»). Si ningún código empieza así, los que lo contienen.
 * - Texto: todas las palabras deben estar en el concepto de la subcuenta o en
 *   el de su cuenta («bancos» → las subcuentas de 1110 BANCOS). Primero las
 *   que coinciden por su propio concepto.
 */
export function searchLeaves(index: PucIndex, query: string, limit = 40): LeafSearch {
  const q = normalizeKey(query);
  if (!q) return { results: [], total: 0 };

  if (/^\d+$/.test(q)) {
    let found = index.leaves.filter((l) => l.code.startsWith(q));
    // Un nivel del catálogo sin subcuentas explícitas (solo trae un rango): no hay nada que ofrecer.
    const parent = found.length === 0 && q.length < 6 ? index.concepts.get(q) : undefined;
    if (parent) return { results: [], total: 0, note: `${q} — ${parent} no tiene subcuentas de 6 dígitos en el catálogo.` };
    if (found.length === 0 && q.length < 6) found = index.leaves.filter((l) => l.code.includes(q));
    const result: LeafSearch = { results: found.slice(0, limit).map(plain), total: found.length };
    if (q.length === 6 && found.length === 1) result.exact = plain(found[0]);
    return result;
  }

  const words = q.split(" ");
  const own: Leaf[] = [];
  const byAccount: Leaf[] = [];
  for (const l of index.leaves) {
    if (words.every((w) => l.key.includes(w) || l.code.startsWith(w))) own.push(l);
    else if (words.every((w) => l.key.includes(w) || l.accountKey.includes(w) || l.code.startsWith(w))) byAccount.push(l);
  }
  const found = [...own, ...byAccount];
  return { results: found.slice(0, limit).map(plain), total: found.length };
}

/** Fila de la Tabla de Códigos PUC. */
export interface PucRow {
  level: PucLevel;
  code: string;
  /** undefined: el nivel no está en el catálogo fuente (solo agrupa a sus hijos). */
  concept?: string;
}

/** Prefijos que son ancestros de un código: «110505» → «1», «11», «1105». */
const ancestors = (code: string) => [1, 2, 4].filter((n) => n < code.length).map((n) => code.slice(0, n));

/**
 * Filas del catálogo con su jerarquía, en el orden del PUC.
 *
 * - `classCode`: solo esa clase (primer dígito). Se ignora al buscar.
 * - `query`: por código (prefijo) o concepto. Se muestran las coincidencias,
 *   sus niveles superiores (contexto) y todo lo que cuelga de una coincidencia.
 *
 * Un nivel que falta en la fuente (ej. un grupo sin fila propia) se agrega
 * como encabezado sin concepto para que sus cuentas no queden sueltas.
 */
export function catalogRows(index: PucIndex, options: { classCode?: string; query?: string } = {}): PucRow[] {
  const q = normalizeKey(options.query ?? "");
  let visible: Set<string> | undefined;

  if (q) {
    const digits = /^\d+$/.test(q);
    const words = q.split(" ");
    const matched = index.all.filter((c) => (digits ? c.code.startsWith(q) : words.every((w) => normalizeKey(c.concept).includes(w)))).map((c) => c.code);
    visible = new Set<string>();
    for (const code of matched) {
      visible.add(code);
      for (const a of ancestors(code)) visible.add(a);
    }
    // Lo que cuelga de un nivel que coincide también se muestra.
    const parents = matched.filter((c) => c.length < 6);
    if (parents.length) for (const c of index.all) if (parents.some((p) => c.code.startsWith(p))) visible.add(c.code);
  }

  const rows: PucRow[] = [];
  const emitted = new Set<string>();
  for (const c of index.all) {
    if (visible ? !visible.has(c.code) : options.classCode !== undefined && c.code[0] !== options.classCode) continue;
    for (const a of ancestors(c.code)) {
      if (emitted.has(a)) continue;
      emitted.add(a);
      if (!index.concepts.has(a)) rows.push({ level: levelOf(a)!, code: a });
    }
    emitted.add(c.code);
    rows.push({ level: levelOf(c.code)!, code: c.code, concept: c.concept });
  }
  return rows;
}

/** Clases del catálogo (1 ACTIVO … 9), para las pestañas de la tabla. */
export const pucClasses = (index: PucIndex) => index.all.filter((c) => c.code.length === 1);
