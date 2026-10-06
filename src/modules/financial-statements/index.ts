import { lazy } from "react";
import { ChartNoAxesCombined, ListTree } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

/**
 * Preparación de estados financieros. Cada herramienta es un submódulo; las
 * futuras se agregan a `submodules`.
 */
export const financialStatementsModule: ModuleDef = {
  id: "estados-financieros",
  name: "Estados Financieros",
  description: "Clasifica facturas por código PUC y consolida sus valores.",
  icon: ChartNoAxesCombined,
  accent: "green",
  submoduleCards: "name",
  submodules: [
    {
      id: "codigos-puc-por-factura",
      name: "Códigos PUC por factura",
      description: "Asigna códigos PUC a las facturas de una carpeta (por factura o por producto) y consolida los valores por código.",
      icon: ListTree,
      component: lazy(() => import("./puc-codes/PucCodesPage")),
    },
  ],
};
