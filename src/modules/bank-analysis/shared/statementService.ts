import { call } from "../../../services/tauri";

export interface PickedStatement {
  fileName: string;
  data: Uint8Array;
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const statementService = {
  /** Diálogo nativo de macOS (solo .pdf). null si el usuario cancela. Nada se guarda. */
  async pickPdf(): Promise<PickedStatement | null> {
    const picked = await call<{ fileName: string; dataBase64: string } | null>("pick_statement_pdf");
    return picked && { fileName: picked.fileName, data: fromBase64(picked.dataBase64) };
  },
};
