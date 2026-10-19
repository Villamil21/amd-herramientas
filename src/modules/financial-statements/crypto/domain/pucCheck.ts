import { resolverOf } from "../../shared/pucGroups";
import type { FsCatalog, FsLine, FsPucMapping } from "../../../../types/fs";
import { isAssignable, type PucIndex } from "../../puc-codes/services/pucCatalog";
import { presentationOf } from "../../shared/presentation";
import type { PucCheck } from "./eeff";

/** Línea del Estado de Resultados que debe recibir cada componente: el Generador condensa y separa por el rol de la línea. */
const EXPECTED_ROLE: Record<string, { role: NonNullable<FsLine["role"]>; label: string }> = {
  "crypto.sales": { role: "sales", label: "Ventas" },
  "crypto.cost_of_sales": { role: "cost_of_sales", label: "Costo de ventas" },
  "crypto.third_income": { role: "third_party_income", label: "Ingresos para terceros" },
  "crypto.third_cost": { role: "third_party_cost", label: "Costo de terceros" },
};

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
    const located = valid && presentation.state === "line";
    const expected = EXPECTED_ROLE[key];
    if (located && expected && catalog) {
      // La línea debe existir, estar activa y ser la de su rol: si no, el Generador no la mostraría donde corresponde (o la dejaría sin clasificar).
      const m = resolverOf(mappings).resolve(code)?.mapping;
      const line = catalog.lines.find((l) => l.id === m?.lineId);
      if (line && !line.isActive) return { code, valid, located: false, location: presentation.text, problem: `La cuenta ${code} apunta a la línea desactivada «${line.name}» de Estados Financieros: actívala o elige otra cuenta.` };
      if (line && line.role !== expected.role) return { code, valid, located: false, location: presentation.text, problem: `La cuenta ${code} está ubicada en «${line.name}», no en «${expected.label}»: ubícala en esa línea del Estado de Resultados.` };
    }
    return { code, valid, located, location: presentation.text };
  };
}
