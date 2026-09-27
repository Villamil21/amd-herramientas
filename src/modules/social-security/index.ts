import { HeartPulse, ClipboardList } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

export const socialSecurityModule: ModuleDef = {
  id: "seguridad-social",
  name: "Seguridad social",
  description: "Resúmenes de planillas de aportes.",
  icon: HeartPulse,
  submodules: [
    { id: "resumen-planilla", name: "Resumen de planilla", description: "Resumen de la planilla de seguridad social.", icon: ClipboardList },
  ],
};
