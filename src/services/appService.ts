import type { StartupInfo } from "../types/models";
import { call } from "./tauri";

export const appService = {
  startupInfo: () => call<StartupInfo>("get_startup_info"),
  dataLocation: () => call<string>("get_data_location"),
  revealDataFolder: () => call<void>("reveal_data_folder"),
};
