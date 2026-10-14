import { lazy } from "react";
import { BriefcaseBusiness, Calculator, UserRoundCheck } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

/** Calculadoras. Cada calculadora es un submódulo; las futuras se agregan a `submodules`. */
export const calculatorsModule: ModuleDef = {
  id: "calculadoras",
  name: "Calculadoras",
  description: "Calcula aportes a seguridad social y parafiscales.",
  icon: Calculator,
  accent: "indigo",
  submoduleCards: "name",
  submodules: [
    {
      id: "aportes-dependientes",
      name: "Calculadora de aportes para Dependientes",
      description: "Aportes de salud, pensión, ARL, CCF, SENA e ICBF sobre el salario o IBC.",
      icon: UserRoundCheck,
      component: lazy(() => import("./contributions/DependentContributionsPage")),
    },
    {
      id: "aportes-independientes",
      name: "Calculadora de aportes para Independientes",
      description: "IBC del 40 % de los ingresos (mínimo un SMMLV) y aportes de salud, pensión, ARL y CCF.",
      icon: BriefcaseBusiness,
      component: lazy(() => import("./contributions/IndependentContributionsPage")),
    },
  ],
};
