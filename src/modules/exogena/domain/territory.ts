import type { ExoCatalogs } from "../../../types/exogena";
import { COLOMBIA } from "./thirdParty";

/** Clave para comparar nombres de lugares: sin tildes, mayúsculas y sin puntuación («Bogotá, D.C.» = «BOGOTA D C»). */
export const placeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/** El elemento con ese nombre: exacto o, si no, el único cuyo nombre empieza igual («Bogotá» → «Bogotá D.C.»). */
function byName<T>(list: T[], name: string, nameOf: (t: T) => string): T | undefined {
  const key = placeKey(name);
  if (!key) return undefined;
  const exact = list.filter((t) => placeKey(nameOf(t)) === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const prefixed = list.filter((t) => placeKey(nameOf(t)).startsWith(`${key} `));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

export const countryByName = (catalogs: ExoCatalogs, name: string) => byName(catalogs.countries, name, (c) => c.name);
export const departmentByName = (catalogs: ExoCatalogs, name: string) => byName(catalogs.departments, name, (d) => d.name);

/** Municipio por nombre dentro de un departamento o, sin departamento, el único del país con ese nombre. */
export function municipalityByName(catalogs: ExoCatalogs, name: string, deptCode?: string) {
  return byName(deptCode ? catalogs.municipalities.filter((m) => m.deptCode === deptCode) : catalogs.municipalities, name, (m) => m.name);
}

export interface NamedPlace {
  country?: string;
  department?: string;
  city?: string;
}

export interface ResolvedPlace {
  countryCode: string;
  deptCode: string;
  muniCode: string;
  warnings: string[];
}

/**
 * Códigos Exógena de un lugar escrito con nombres (por ejemplo, en una factura). Lo que no se puede resolver con certeza queda
 * vacío y se explica: nunca se adivina un municipio.
 */
export function resolveTerritoryByName(catalogs: ExoCatalogs, place: NamedPlace): ResolvedPlace {
  const warnings: string[] = [];
  const country = place.country ? countryByName(catalogs, place.country) : undefined;
  if (place.country && !country) warnings.push(`El país «${place.country}» no está en el catálogo de Exógena.`);
  if (country && country.code !== COLOMBIA) return { countryCode: country.code, deptCode: "", muniCode: "", warnings };
  // Sin país impreso pero con departamento / ciudad colombianos se asume Colombia solo si se resuelven en el catálogo.
  const dept = place.department ? departmentByName(catalogs, place.department) : undefined;
  if (place.department && !dept) warnings.push(`El departamento «${place.department}» no está en el catálogo de Exógena.`);
  const muni = place.city ? municipalityByName(catalogs, place.city, dept?.code) : undefined;
  if (place.city && !muni) warnings.push(`El municipio «${place.city}» no se pudo identificar${dept ? ` en ${dept.name}` : ""}.`);
  const deptCode = dept?.code ?? muni?.deptCode ?? "";
  return { countryCode: country?.code ?? (deptCode ? COLOMBIA : ""), deptCode, muniCode: deptCode && muni && muni.deptCode === deptCode ? muni.code : "", warnings };
}
