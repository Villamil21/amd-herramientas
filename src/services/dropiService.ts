import type { DropiStatusMapping, DropiStatusMappingInput } from "../types/models";
import { call } from "./tauri";

export const dropiService = {
  listStatusMappings: () => call<DropiStatusMapping[]>("list_dropi_status_mappings"),
  /** Crea o actualiza (por estado normalizado) varias reglas en una sola transacción. */
  saveStatusMappings: (items: DropiStatusMappingInput[]) => call<void>("save_dropi_status_mappings", { items }),
  updateStatusMapping: (id: number, category: DropiStatusMapping["category"]) => call<void>("update_dropi_status_mapping", { id, category }),
  removeStatusMapping: (id: number) => call<void>("delete_dropi_status_mapping", { id }),
};
