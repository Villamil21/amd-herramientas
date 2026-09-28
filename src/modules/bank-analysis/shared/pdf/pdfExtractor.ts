import { StatementError } from "../types";
import { readDocumentText } from "./pdfText";
import type { PdfDocumentText } from "./pdfTypes";

/**
 * Abre el PDF en el propio equipo con pdf.js (sin red, sin OCR) y devuelve
 * el texto posicionado de todas sus páginas. pdf.js se carga solo al usarlo.
 */
export async function extractPdfText(data: Uint8Array): Promise<PdfDocumentText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  // Solo se lee texto: sin fuentes del sistema, sin WebAssembly y sin descargas.
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    return await readDocumentText(await task.promise);
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") {
      throw new StatementError("El PDF está protegido con contraseña. Quita la protección e inténtalo de nuevo.");
    }
    if (import.meta.env.DEV) console.error("[pdf]", e);
    throw new StatementError("No fue posible leer el PDF. Verifica que el archivo no esté dañado.");
  } finally {
    await task.destroy();
  }
}
