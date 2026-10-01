import { lazy } from "react";
import { FileSpreadsheet, FileText, ShieldCheck } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

/**
 * Procesos regulatorios. Cada entidad de control es un submódulo (UIAF…) y
 * sus procesos son el tercer nivel: nuevos reportes UIAF se agregan como
 * otro elemento de `providers`.
 */
export const regulatoryReportsModule: ModuleDef = {
  id: "reportes-regulatorios",
  name: "Reportes regulatorios",
  description: "Genera reportes y archivos para organismos reguladores.",
  icon: FileText,
  accent: "amber",
  submoduleCards: "name",
  submodules: [
    {
      id: "uiaf",
      name: "TPSV a Excel",
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
