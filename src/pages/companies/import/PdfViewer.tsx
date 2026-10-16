import { useEffect, useRef, useState } from "react";
import { Alert, Loader } from "../../../components/ui";

async function renderPages(bytes: Uint8Array, host: HTMLElement, cssWidth: number, isCurrent: () => boolean) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  // pdf.js puede transferir el buffer al worker: se le pasa una copia.
  const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, useWorkerFetch: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    host.replaceChildren();
    const ratio = window.devicePixelRatio || 1;
    for (let n = 1; n <= pdf.numPages && isCurrent(); n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.display = "block";
      canvas.style.boxShadow = "var(--shadow-md)";
      canvas.style.background = "white";
      canvas.setAttribute("aria-label", `Página ${n} de ${pdf.numPages}`);
      host.appendChild(canvas);
      await page.render({ canvas, viewport }).promise;
      page.cleanup();
    }
    return pdf.numPages;
  } finally {
    await task.destroy();
  }
}

/** Todas las páginas de un PDF, una debajo de otra, dibujadas en el equipo con pdf.js. */
export function PdfViewer({ bytes, width = 720 }: { bytes: Uint8Array | null; width?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!bytes || !host.current) return;
    let current = true;
    setError(null);
    setLoading(true);
    renderPages(bytes, host.current, width, () => current).then(
      () => current && setLoading(false),
      (cause) => {
        if (!current) return;
        setLoading(false);
        setError((cause as Error).message || "No se pudo mostrar el documento.");
      },
    );
    return () => {
      current = false;
    };
  }, [bytes, width]);
  return (
    <div className="stack stack--sm" style={{ alignItems: "center" }}>
      {error && <Alert tone="danger">{error}</Alert>}
      {(loading || !bytes) && !error && <Loader />}
      <div ref={host} style={{ width, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 12 }} />
    </div>
  );
}
