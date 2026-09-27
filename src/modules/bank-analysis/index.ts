import { Landmark } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

export const bankAnalysisModule: ModuleDef = {
  id: "extractos-bancarios",
  name: "Análisis de extractos bancarios",
  description: "Lectura y análisis de extractos por banco.",
  icon: Landmark,
  submodules: [
    { id: "bancolombia", name: "Bancolombia", description: "Extractos de Bancolombia.", icon: Landmark },
    { id: "banco-de-bogota", name: "Banco de Bogotá", description: "Extractos del Banco de Bogotá.", icon: Landmark },
    { id: "davivienda", name: "Davivienda", description: "Extractos de Davivienda.", icon: Landmark },
  ],
};
