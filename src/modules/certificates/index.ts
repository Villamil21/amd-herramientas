import { lazy } from "react";
import { FileBadge2, FileCheck2, TableProperties } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

export const certificatesModule: ModuleDef = {
  id: "certificados",
  name: "Certificados",
  description: "Certificados tributarios generados a partir de la información contable.",
  icon: FileBadge2,
  submodules: [
    { id: "composicion-accionaria", name: "Composición Accionaria", description: "Certificado de capital y participación de accionistas.", icon: TableProperties, component: lazy(() => import("./composition/CompositionCertificatePage")) },
    {
      id: "retencion",
      name: "Certificado de retención",
      description: "Retención en la fuente e ICA a partir del reporte de documentos electrónicos en Excel.",
      icon: FileCheck2,
      component: lazy(() => import("./withholding/WithholdingCertificatePage")),
    },
  ],
};
