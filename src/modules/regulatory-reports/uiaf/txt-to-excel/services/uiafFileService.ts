import { call } from "../../../../../services/tauri";
import { fromBase64 } from "../../../../bank-analysis/shared/statementService";

export interface PickedTxt {
  fileName: string;
  data: Uint8Array;
}

/** Diálogo nativo de macOS (solo .txt). null si el usuario cancela. Nada se guarda. */
export async function pickUiafTxt(): Promise<PickedTxt | null> {
  const picked = await call<{ fileName: string; dataBase64: string } | null>("pick_report_txt", { title: "Seleccionar archivo TXT de la UIAF" });
  return picked && { fileName: picked.fileName, data: fromBase64(picked.dataBase64) };
}
