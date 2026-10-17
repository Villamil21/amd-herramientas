import type { ExoCatalogs } from "../../../../types/exogena";
import { compareText } from "./documents";
import type { Homologation } from "./types";

/**
 * Ciudad de cada compra («Código mcp») → municipio DANE. El valor puede ser un código o el nombre de la ciudad: se compara
 * ignorando mayúsculas, tildes y espacios accidentales con la tabla de municipios de Exógena. Lo que no se reconoce o es
 * ambiguo nunca se adivina: el usuario elige el municipio y el alias queda guardado.
 */

export interface CityOption {
  /** Departamento (2) + municipio (3) = código DANE de 5 dígitos. */
  code: string;
  deptCode: string;
  muniCode: string;
  name: string;
  deptName: string;
}

export interface PlaceLookup {
  options: CityOption[];
  byCode: ReadonlyMap<string, CityOption>;
  byName: ReadonlyMap<string, CityOption[]>;
  /** Alias guardados: texto normalizado de origen → código DANE. */
  aliases: ReadonlyMap<string, string>;
}

export type CityResolution =
  | { status: "resolved"; option: CityOption; via: "code" | "name" | "alias" }
  | { status: "ambiguous"; candidates: CityOption[] }
  | { status: "unknown" }
  | { status: "empty" };

export const cityLabel = (o: CityOption) => `${o.name} (${o.deptName}) · ${o.code}`;

export function buildPlaceLookup(catalogs: ExoCatalogs, homologations: readonly Homologation[]): PlaceLookup {
  const departments = new Map(catalogs.departments.map((d) => [d.code, d.name]));
  const options = catalogs.municipalities
    .filter((m) => m.isActive)
    .map<CityOption>((m) => ({ code: `${m.deptCode}${m.code}`, deptCode: m.deptCode, muniCode: m.code, name: m.name, deptName: departments.get(m.deptCode) ?? m.deptCode }));
  const byCode = new Map(options.map((o) => [o.code, o]));
  const byName = new Map<string, CityOption[]>();
  for (const o of options) {
    const key = compareText(o.name);
    byName.set(key, [...(byName.get(key) ?? []), o]);
  }
  const aliases = new Map(homologations.filter((h) => h.kind === "city").map((h) => [h.sourceKey, h.value]));
  return { options, byCode, byName, aliases };
}

/** Clave con la que se guarda el alias de un texto de ciudad. */
export const cityAliasKey = (raw: string) => compareText(raw);

export function resolveCity(raw: string | undefined | null, lookup: PlaceLookup): CityResolution {
  const value = (raw ?? "").trim();
  if (!value) return { status: "empty" };
  const key = compareText(value);
  if (!key) return { status: "empty" };
  const alias = lookup.aliases.get(key);
  const aliased = alias ? lookup.byCode.get(alias) : undefined;
  if (aliased) return { status: "resolved", option: aliased, via: "alias" };
  // Código DANE escrito como número (5001 pierde su cero inicial en Excel: 05001).
  if (/^\d{4,5}$/.test(key)) {
    const option = lookup.byCode.get(key.padStart(5, "0"));
    return option ? { status: "resolved", option, via: "code" } : { status: "unknown" };
  }
  const exact = lookup.byName.get(key) ?? [];
  if (exact.length === 1) return { status: "resolved", option: exact[0], via: "name" };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };
  // «Bogotá» → «Bogotá D.C.»: un único nombre que empieza igual.
  const prefixed = lookup.options.filter((o) => compareText(o.name).startsWith(`${key} `));
  if (prefixed.length === 1) return { status: "resolved", option: prefixed[0], via: "name" };
  return { status: "unknown" };
}

/** Buscador de municipios para la revisión: por nombre, departamento o código. */
export function searchCities(lookup: PlaceLookup, query: string, limit = 30): CityOption[] {
  const q = compareText(query);
  if (!q) return [];
  const scored = lookup.options
    .map((o) => {
      const name = compareText(o.name);
      const dept = compareText(o.deptName);
      const rank = o.code === q ? 0 : name === q ? 1 : name.startsWith(q) ? 2 : name.includes(q) ? 3 : `${name} ${dept}`.includes(q) ? 4 : 99;
      return { o, rank };
    })
    .filter((x) => x.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.o.name.localeCompare(b.o.name, "es"));
  return scored.slice(0, limit).map((x) => x.o);
}
