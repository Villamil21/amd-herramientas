import type { BackupSummary } from "../types/models";
import { call } from "./tauri";

export const backupService = {
  export: () => call<string | null>("export_backup"),
  /** Lee y valida un backup sin modificar nada. */
  pick: () => call<BackupSummary | null>("pick_backup_file"),
  /** Reemplaza los datos actuales (crea antes una copia .sqlite automática). */
  apply: () => call<void>("apply_pending_backup"),
  discard: () => call<void>("discard_pending_backup"),
};
