import { useEffect, useRef, useState } from "react";
import { Alert, Loader } from "../../../components/ui";

/**
 * Dibuja la primera página del PDF (sin membrete). El membrete va debajo como <img>:
 * el navegador lo escala con suavizado (pdf.js en WebKit lo pixelaba). El canvas se
 * combina en modo "multiply": el blanco deja ver el membrete y el texto queda igual.
 */
async function renderPage(bytes: Uint8Array, canvas: HTMLCanvasElement, cssWidth: number) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  // pdf.js puede transferir el buffer al worker: se le pasa una copia.
  const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, useWorkerFetch: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return pdf.numPages;
  } finally {
    await task.destroy();
  }
}

/** `bytes`: el certificado sin membrete; `background`: el membrete de página completa (misma proporción). */
export function PdfPagePreview({ bytes, background, width = 640 }: { bytes: Uint8Array | null; background: string; width?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  useEffect(() => {
    if (!bytes || !canvas.current) return;
    let current = true;
    setError(null);
    renderPage(bytes, canvas.current, width).then(
      (n) => current && setPages(n),
      (cause) => current && setError((cause as Error).message || "No se pudo mostrar la vista previa."),
    );
    return () => {
      current = false;
    };
  }, [bytes, width]);
  return (
    <div className="stack stack--sm" style={{ alignItems: "center" }}>
      {error && <Alert tone="danger">{error}</Alert>}
      {pages !== null && pages > 1 && <Alert tone="warning">El certificado ocupa {pages} páginas.</Alert>}
      {!bytes && <Loader />}
      <div style={{ position: "relative", width, maxWidth: "100%", aspectRatio: "595.28 / 841.89", boxShadow: "var(--shadow-md)", borderRadius: 4, overflow: "hidden", background: "white", display: bytes ? "block" : "none" }}>
        <img src={background} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        <canvas ref={canvas} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", mixBlendMode: "multiply" }} />
      </div>
    </div>
  );
}
