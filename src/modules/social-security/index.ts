import { lazy } from "react";
import { HeartPulse, ClipboardList } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

export const socialSecurityModule: ModuleDef = {
  id: "seguridad-social",
  name: "Seguridad social",
  description: "Resúmenes de planillas de aportes.",
  icon: HeartPulse,
  submodules: [
    {
      id: "resumen-planilla",
      name: "Resumen de planilla",
      description: "Resumen de la planilla de seguridad social.",
      icon: ClipboardList,
      providers: [
        {
          id: "aportes-en-linea",
          name: "Aportes en Línea",
          description: "Resumen y extracción de planillas de seguridad social.",
          icon: ClipboardList,
          logo: "Aportes.png",
          component: lazy(() => import("./payroll-summary/aportes-en-linea/AportesEnLineaPage")),
        },
        // Sin componente = no disponible (punto gris). Pendiente de desarrollo.
        { id: "mi-planilla", name: "Mi Planilla", description: "", icon: ClipboardList },
      ],
    },
  ],
};
