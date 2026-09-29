import { lazy } from "react";
import { ClipboardList, PackageCheck } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

/**
 * Cierres de las empresas que venden con Dropi. Cada cierre es un submódulo;
 * los futuros (pagos, proveedores, conciliaciones…) se agregan a `submodules`.
 */
export const dropiModule: ModuleDef = {
  id: "dropi",
  name: "Dropi",
  description: "Cierres de las empresas que venden con la plataforma Dropi.",
  icon: PackageCheck,
  accent: "orange",
  submodules: [
    {
      id: "ordenes",
      name: "Órdenes",
      description: "Resume ventas, costos y pedidos a partir del reporte de órdenes exportado desde Dropi.",
      icon: ClipboardList,
      component: lazy(() => import("./orders/DropiOrdersPage")),
    },
  ],
};
