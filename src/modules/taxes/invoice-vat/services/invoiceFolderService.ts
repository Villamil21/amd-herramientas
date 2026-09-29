import { call, errorMessage } from "../../../../services/tauri";
import { extractPdfText } from "../../../bank-analysis/shared/pdf/pdfExtractor";
import { StatementError } from "../../../bank-analysis/shared/types";
import { InvoiceFormatError, parseInvoice } from "../parser/invoiceParser";
import type { FileResult } from "../types";

export interface InvoiceFolder {
  folderName: string;
  files: { name: string; size: number }[];
}

/** Selector nativo de carpetas. Lista los PDF de la carpeta (sin subcarpetas); null si se cancela. */
export const pickInvoiceFolder = () => call<InvoiceFolder | null>("pick_invoice_folder");

/** Bytes de un PDF de la carpeta elegida (solo lectura). */
async function readInvoicePdf(fileName: string): Promise<Uint8Array> {
  return new Uint8Array(await call<ArrayBuffer>("read_invoice_pdf", { fileName }));
}

/** Deja respirar a la interfaz entre archivos (progreso visible, ventana sin congelarse). */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Lee e interpreta un archivo. Nunca lanza: los problemas quedan en el resultado. */
export async function processInvoiceFile(fileName: string): Promise<FileResult> {
  let data: Uint8Array;
  try {
    data = await readInvoicePdf(fileName);
  } catch (e) {
    return { fileName, kind: "error", message: errorMessage(e) };
  }
  try {
    return { fileName, kind: "parsed", invoice: parseInvoice(await extractPdfText(data)) };
  } catch (e) {
    if (e instanceof InvoiceFormatError) return { fileName, kind: "incompatible", message: e.message };
    if (e instanceof StatementError) return { fileName, kind: "error", message: e.message };
    if (import.meta.env.DEV) console.error("[iva-facturas]", fileName, e);
    return { fileName, kind: "error", message: "No fue posible leer la factura. Verifica que el archivo no esté dañado." };
  }
}

/** Procesa los archivos uno a uno; un archivo con problemas no detiene el lote. */
export async function processInvoiceFolder(
  files: string[],
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<FileResult[]> {
  const results: FileResult[] = [];
  for (const [i, name] of files.entries()) {
    if (isCancelled()) break;
    results.push(await processInvoiceFile(name));
    onProgress(i + 1, files.length);
    await nextFrame();
  }
  return results;
}
