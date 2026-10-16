import type { ResetOutcome } from "../types/exogena";
import type { StartupInfo } from "../types/models";
import { call } from "./tauri";

export const appService = {
  startupInfo: () => call<StartupInfo>("get_startup_info"),
  dataLocation: () => call<string>("get_data_location"),
  revealDataFolder: () => call<void>("reveal_data_folder"),
  /**
   * Zona de peligro: vacía TODOS los datos de la aplicación (tras crear una copia recuperable). Solo la dispara el usuario,
   * escribiendo la frase exacta y confirmando por segunda vez; el backend vuelve a exigir ambas.
   */
  resetAppData: (phrase: string, finalConfirmation: boolean) => call<ResetOutcome>("reset_app_data", { phrase, finalConfirmation }),
};
