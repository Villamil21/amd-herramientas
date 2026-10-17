import type { FsCatalog, FsPucMapping } from "../../../../types/fs";
import { isAssignable, type PucIndex } from "../../puc-codes/services/pucCatalog";
import { presentationOf } from "../../shared/presentation";
import type { PucCheck } from "./eeff";

/**
 * Valida una cuenta PUC de la configuración: debe existir como cuenta asignable y tener ubicación en Estados Financieros
 * por la familia de sus cuatro dígitos (o por el código completo), respetando la regla global existente.
 */
export function makePucChecker(settings: ReadonlyMap<string, string>, index: PucIndex, catalog: FsCatalog | null, mappings: Map<string, FsPucMapping>) {
  return (key: string): PucCheck => {
    const code = settings.get(key);
    if (!code) return { code: undefined, valid: false, located: false };
    const valid = isAssignable(index, code);
    const presentation = presentationOf(code, catalog, mappings);
    return { code, valid, located: valid && presentation.state === "line", location: presentation.text };
  };
}
