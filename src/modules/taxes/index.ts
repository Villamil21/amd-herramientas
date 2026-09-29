import { lazy } from "react";
import { Landmark, ReceiptText } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

/**
 * Procesos tributarios. Cada herramienta es un submódulo; las futuras
 * (retenciones, información exógena…) se agregan a `submodules`.
 */
export const taxesModule: ModuleDef = {
  id: "impuestos",
  name: "Impuestos",
  description: "Analiza facturas y prepara información tributaria.",
  icon: Landmark,
  accent: "rose",
  submodules: [
    {
      id: "analisis-iva-facturas",
      name: "Análisis de IVA de facturas",
      description: "Resume bases e IVA por tarifa, tipo de proveedor y tipo de documento a partir de una carpeta de facturas PDF.",
      icon: ReceiptText,
      component: lazy(() => import("./invoice-vat/InvoiceVatPage")),
    },
  ],
};
