import { ShoppingCart } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

export const salesOrdersModule: ModuleDef = {
  id: "ordenes-de-venta",
  name: "Órdenes de venta",
  description: "Gestión de órdenes de venta.",
  icon: ShoppingCart,
  submodules: [],
};
