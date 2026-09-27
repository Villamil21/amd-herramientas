import type { Workbook } from "../types/excel";
import { call } from "./tauri";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const fileService = {
  /** Diálogo nativo para abrir Excel; null si el usuario cancela. */
  pickExcel: () => call<Workbook | null>("pick_excel_file"),
  /** Archivo arrastrado sobre la ventana. */
  loadDroppedExcel: (path: string) => call<Workbook>("load_dropped_excel", { path }),
  /** Diálogo nativo para guardar; devuelve la ruta o null si se cancela. */
  savePdf: (bytes: Uint8Array, suggestedName: string) =>
    call<string | null>("save_pdf", { dataBase64: toBase64(bytes), suggestedName }),
  openSaved: (path: string) => call<void>("open_saved_file", { path, reveal: false }),
  revealSaved: (path: string) => call<void>("open_saved_file", { path, reveal: true }),
};
