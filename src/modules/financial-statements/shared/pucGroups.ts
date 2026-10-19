import type { FsPucMapping } from "../../../types/fs";

/**
 * Clasificación por GRUPO de cuatro dígitos del PUC (2370 cubre 237005, 237006, 237010…).
 *
 * La decisión vive en el código de cuatro dígitos. Las clasificaciones antiguas de subcuentas (seis dígitos) se respetan
 * mientras no se consoliden, pero:
 * - si todas las de un grupo coinciden (y el grupo no tiene decisión propia), valen como la clasificación del grupo («inferred»);
 * - si difieren entre sí, o de la decisión del grupo, hay un CONFLICTO: no se sobrescribe nada ni se inventa una decisión,
 *   el usuario lo resuelve desde el mismo flujo de clasificación del grupo.
 */
export const familyOf = (code: string) => code.trim().slice(0, 4);

type Classification = Pick<FsPucMapping, "pucCode" | "lineId" | "excluded">;

/** Dos mapeos son la misma clasificación si apuntan a la misma línea o ambos excluyen. */
export const classificationKey = (m: Pick<FsPucMapping, "lineId" | "excluded">) => (m.excluded ? "excluded" : `line:${m.lineId}`);

export interface MappingOption<M extends Classification = FsPucMapping> {
  key: string;
  mapping: M;
  /** Códigos que tienen esta clasificación (el grupo mismo y/o subcuentas). */
  codes: string[];
}

export interface FamilyInfo<M extends Classification = FsPucMapping> {
  family: string;
  /** Decisión propia del grupo (cuatro dígitos). */
  own?: M;
  /** Clasificaciones antiguas de subcuentas del grupo. */
  children: M[];
  /** Clasificaciones distintas dentro del grupo; más de una = conflicto. */
  options: MappingOption<M>[];
  conflict: boolean;
  /** Sin decisión propia pero con subcuentas que coinciden: valen para todo el grupo. */
  inferred?: M;
}

export interface Resolved<M extends Classification = FsPucMapping> {
  mapping: M;
  via: "exact" | "family" | "inferred";
}

export interface MappingResolver<M extends Classification = FsPucMapping> {
  /** Clasificación vigente de un código (la propia, la de su grupo o la inferida de sus subcuentas). */
  resolve(code: string): Resolved<M> | undefined;
  info(family: string): FamilyInfo<M>;
}

export function buildMappingResolver<M extends Classification>(mappings: Iterable<M>): MappingResolver<M> {
  const exact = new Map<string, M>();
  const families = new Map<string, { own?: M; children: M[] }>();
  for (const m of mappings) {
    exact.set(m.pucCode, m);
    const f = familyOf(m.pucCode);
    const entry = families.get(f) ?? { children: [] };
    if (m.pucCode.length > 4) entry.children.push(m);
    else if (m.pucCode.length === 4) entry.own = m;
    families.set(f, entry);
  }
  const infos = new Map<string, FamilyInfo<M>>();
  const info = (family: string): FamilyInfo<M> => {
    let i = infos.get(family);
    if (i) return i;
    const entry = families.get(family) ?? { children: [] };
    const options = new Map<string, MappingOption<M>>();
    for (const m of [...(entry.own ? [entry.own] : []), ...entry.children]) {
      const key = classificationKey(m);
      const o = options.get(key) ?? { key, mapping: m, codes: [] };
      o.codes.push(m.pucCode);
      options.set(key, o);
    }
    const list = [...options.values()];
    i = { family, own: entry.own, children: entry.children, options: list, conflict: list.length > 1, inferred: !entry.own && entry.children.length > 0 && list.length === 1 ? list[0].mapping : undefined };
    infos.set(family, i);
    return i;
  };
  return {
    info,
    resolve(code) {
      const e = exact.get(code);
      if (e) return { mapping: e, via: "exact" };
      const f = familyOf(code);
      const i = info(f);
      if (i.own) return { mapping: i.own, via: "family" };
      if (i.inferred) return { mapping: i.inferred, via: "inferred" };
      return undefined;
    },
  };
}

const cache = new WeakMap<object, MappingResolver>();

/** Resolver de un mapa de mapeos (el de `useFsData`), memoizado por mapa. */
export function resolverOf(mappings: Map<string, FsPucMapping>): MappingResolver {
  let r = cache.get(mappings);
  if (!r) cache.set(mappings, (r = buildMappingResolver(mappings.values())));
  return r;
}
