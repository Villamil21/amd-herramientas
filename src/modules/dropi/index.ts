import { lazy } from "react";
import { ClipboardList, PackageCheck, Wallet } from "lucide-react";
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
  submoduleCards: "name",
  submodules: [
    {
      id: "ordenes",
      name: "Órdenes",
      description: "Resume ventas, costos y pedidos a partir del reporte de órdenes exportado desde Dropi.",
      icon: ClipboardList,
      component: lazy(() => import("./orders/DropiOrdersPage")),
    },
    {
      id: "historial-carteras",
      name: "Historial de cartera",
      description: "Resume los retiros de la cartera Dropi: valor pagado y 4x1000 a partir del historial exportado.",
      icon: Wallet,
      component: lazy(() => import("./wallet-history/WalletHistoryPage")),
    },
  ],
};
