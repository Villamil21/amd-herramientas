import type { MinimumWage } from "../types/models";
import { call } from "./tauri";

/** SMMLV por año: configuración local y manual, reutilizable por cualquier módulo. */
export const minimumWageService = {
  list: () => call<MinimumWage[]>("list_minimum_wages"),
  /** Un año nuevo siempre se crea completo: SMMLV y auxilio de transporte. */
  create: (year: number, valuePesos: number, transportAllowancePesos: number) => call<void>("create_minimum_wage", { year, valuePesos, transportAllowancePesos }),
  update: (year: number, valuePesos: number) => call<void>("update_minimum_wage", { year, valuePesos }),
  /** Auxilio de transporte mensual del año (null = sin configurar). */
  setTransportAllowance: (year: number, pesos: number | null) => call<void>("set_transport_allowance", { year, pesos }),
};
