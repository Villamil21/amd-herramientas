import { lazy } from "react";
import { FileSpreadsheet, Landmark, ShieldCheck } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

/**
 * Procesos regulatorios. Cada entidad de control es un submódulo (UIAF…) y
 * sus procesos son el tercer nivel: nuevos reportes UIAF se agregan como
 * otro elemento de `providers`.
 */
export const regulatoryReportsModule: ModuleDef = {
  id: "reportes-regulatorios",
  name: "Reportes regulatorios",
  description: "Preparación y revisión de reportes para entidades de control.",
  icon: Landmark,
  submodules: [
    {
      id: "uiaf",
      name: "UIAF",
      description: "Reportes a la Unidad de Información y Análisis Financiero.",
      icon: ShieldCheck,
      providersDescription: "Selecciona el proceso de UIAF.",
      providers: [
        {
          id: "conversion-txt-excel",
          name: "Conversión TXT a Excel",
          description: "Convierte archivos TXT de reportes UIAF en hojas de cálculo estructuradas.",
          icon: FileSpreadsheet,
          component: lazy(() => import("./uiaf/txt-to-excel/UiafTxtToExcelPage")),
        },
      ],
    },
  ],
};
