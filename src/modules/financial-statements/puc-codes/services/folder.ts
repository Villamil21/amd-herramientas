import { call, errorMessage } from "../../../../services/tauri";
import { extractPdfText } from "../../../bank-analysis/shared/pdf/pdfExtractor";
import { StatementError } from "../../../bank-analysis/shared/types";
import { InvoiceFormatError } from "../../../taxes/invoice-vat/parser/invoiceParser";
import { parsePucDocument } from "../parser/pucParser";
import type { FileResult } from "../types";

export { pickInvoiceFolder, type InvoiceFolder } from "../../../taxes/invoice-vat/services/invoiceFolderService";

/** Deja respirar a la interfaz entre archivos (progreso visible, ventana sin congelarse). */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Lee e interpreta un archivo de la carpeta elegida (solo lectura). Nunca lanza. */
async function processFile(fileName: string): Promise<FileResult> {
  let data: Uint8Array;
  try {
    data = new Uint8Array(await call<ArrayBuffer>("read_invoice_pdf", { fileName }));
  } catch (e) {
    return { fileName, kind: "error", message: errorMessage(e) };
  }
  try {
    return { fileName, kind: "parsed", doc: parsePucDocument(await extractPdfText(data)) };
  } catch (e) {
    if (e instanceof InvoiceFormatError) return { fileName, kind: "incompatible", message: e.message };
    if (e instanceof StatementError) return { fileName, kind: "error", message: e.message };
    if (import.meta.env.DEV) console.error("[codigos-puc]", fileName, e);
    return { fileName, kind: "error", message: "No fue posible leer el documento. Verifica que el archivo no esté dañado." };
  }
}

/** Procesa los archivos uno a uno; un archivo con problemas no detiene el lote. */
export async function processPucFolder(files: string[], onProgress: (done: number, total: number) => void, isCancelled: () => boolean): Promise<FileResult[]> {
  const results: FileResult[] = [];
  for (const [i, name] of files.entries()) {
    if (isCancelled()) break;
    results.push(await processFile(name));
    onProgress(i + 1, files.length);
    await nextFrame();
  }
  return results;
}
