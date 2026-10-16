import type { ExoCatalogs } from "../../../types/exogena";

/** Búsquedas rápidas sobre los catálogos de Exógena (tipos de documento, países, departamentos y municipios). */
export interface CatalogIndex {
  docType: (code: string) => string | undefined;
  country: (code: string) => string | undefined;
  department: (code: string) => string | undefined;
  /** Municipio por departamento + código: («76», «001») → «Cali». */
  municipality: (deptCode: string, muniCode: string) => string | undefined;
}

export function buildCatalogIndex(catalogs: ExoCatalogs): CatalogIndex {
  const docTypes = new Map(catalogs.documentTypes.map((d) => [d.code, d.description]));
  const countries = new Map(catalogs.countries.map((c) => [c.code, c.name]));
  const departments = new Map(catalogs.departments.map((d) => [d.code, d.name]));
  const municipalities = new Map(catalogs.municipalities.map((m) => [`${m.deptCode}${m.code}`, m.name]));
  return {
    docType: (code) => docTypes.get(code),
    country: (code) => countries.get(code),
    department: (code) => departments.get(code),
    municipality: (deptCode, muniCode) => municipalities.get(`${deptCode}${muniCode}`),
  };
}
