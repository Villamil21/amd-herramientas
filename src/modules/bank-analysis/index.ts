import { lazy } from "react";
import { Landmark } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

export const bankAnalysisModule: ModuleDef = {
  id: "extractos-bancarios",
  name: "Análisis de extractos bancarios",
  description: "Lectura y análisis de extractos por banco.",
  icon: Landmark,
  submoduleCards: "logo",
  submodules: [
    {
      id: "bancolombia",
      name: "Bancolombia",
      description: "Análisis de extractos bancarios.",
      icon: Landmark,
      logo: "Bancolombia.png",
      component: lazy(() => import("./bancolombia/BancolombiaStatementPage")),
    },
    {
      id: "coopcentral",
      name: "Coopcentral",
      description: "Análisis de extractos bancarios.",
      icon: Landmark,
      logo: "Coopcentral.png",
      component: lazy(() => import("./coopcentral/CoopcentralStatementPage")),
    },
    {
      id: "davivienda",
      name: "Davivienda",
      description: "Análisis de extractos bancarios.",
      icon: Landmark,
      logo: "Davivienda.png",
      component: lazy(() => import("./davivienda/DaviviendaStatementPage")),
    },
    { id: "banco-de-bogota", name: "Banco de Bogotá", description: "Extractos del Banco de Bogotá.", icon: Landmark },
  ],
};
