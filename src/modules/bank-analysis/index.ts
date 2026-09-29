import { lazy } from "react";
import { FileChartColumn, Landmark } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

export const bankAnalysisModule: ModuleDef = {
  id: "extractos-bancarios",
  name: "Extractos bancarios",
  description: "Analiza, valida y concilia extractos bancarios de forma automatizada.",
  icon: FileChartColumn,
  accent: "blue",
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
    {
      id: "iris-bank",
      name: "Iris Bank",
      description: "Análisis de extractos bancarios.",
      icon: Landmark,
      logo: "Iris.png",
      component: lazy(() => import("./iris-bank/IrisBankStatementPage")),
    },
    {
      id: "bancoomeva",
      name: "Bancoomeva",
      description: "Análisis de extractos bancarios.",
      icon: Landmark,
      logo: "Bancoomeva.png",
      component: lazy(() => import("./bancoomeva/BancoomevaStatementPage")),
    },
    { id: "banco-de-bogota", name: "Banco de Bogotá", description: "Extractos del Banco de Bogotá.", icon: Landmark },
  ],
};
