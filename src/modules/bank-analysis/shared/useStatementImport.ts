import { useCallback, useState } from "react";
import { useToast } from "../../../components/ui";
import { useShortcut } from "../../../hooks/useShortcut";
import { activityService, analysisStatus } from "../../../services/activityService";
import { errorMessage } from "../../../services/tauri";
import { extractPdfText } from "./pdf/pdfExtractor";
import type { PdfDocumentText } from "./pdf/pdfTypes";
import { statementService } from "./statementService";
import { StatementError } from "./types";

export type ImportState<A> =
  | { status: "idle" }
  | { status: "analyzing"; fileName: string; pageCount?: number; /** Última página leída. */ page?: number }
  | { status: "error"; fileName: string; pageCount?: number; message: string }
  | { status: "done"; fileName: string; pageCount: number; analysis: A };

interface Options<A> {
  /** Parser del banco + agrupación + validación sobre el texto ya extraído. */
  analyze: (text: PdfDocumentText) => A;
  /** Guarda el Excel con el diálogo nativo; devuelve la ruta o null si se cancela. */
  exportExcel: (analysis: A, fileName: string) => Promise<string | null>;
  /** Mensaje cuando el error no es un StatementError (ya pensado para el usuario). */
  fallbackError: string;
  logTag: string;
  /** Título del diálogo de selección (por defecto «Seleccionar extracto PDF»). */
  pickTitle?: string;
}

/**
 * Flujo común de todos los bancos: seleccionar PDF → extraer texto de todas
 * las páginas → analizar → exportar. El PDF solo vive en memoria: nada se
 * guarda ni se envía.
 */
export function useStatementImport<A>({ analyze, exportExcel, fallbackError, logTag, pickTitle }: Options<A>) {
  const toast = useToast();
  const [state, setState] = useState<ImportState<A>>({ status: "idle" });
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const busy = picking || state.status === "analyzing";

  const pick = useCallback(async () => {
    if (busy) return;
    setPicking(true);
    try {
      const picked = await statementService.pickPdf(pickTitle);
      if (!picked) return;
      setExportedPath(null);
      const { fileName } = picked;
      setState({ status: "analyzing", fileName });
      let pageCount: number | undefined;
      try {
        const text = await extractPdfText(picked.data, (page, total) => setState({ status: "analyzing", fileName, pageCount: total, page }));
        pageCount = text.pageCount;
        const analysis = analyze(text);
        setState({ status: "done", fileName, pageCount, analysis });
        activityService.record(fileName, analysisStatus(analysis));
      } catch (e) {
        if (!(e instanceof StatementError) && import.meta.env.DEV) console.error(`[${logTag}]`, e);
        const message = e instanceof StatementError ? e.message : fallbackError;
        setState({ status: "error", fileName, pageCount, message });
        activityService.record(fileName, "error");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPicking(false);
    }
  }, [busy, toast, analyze, fallbackError, logTag, pickTitle]);

  const runExport = useCallback(async () => {
    if (state.status !== "done" || exporting) return;
    setExporting(true);
    try {
      const path = await exportExcel(state.analysis, state.fileName);
      if (path) {
        setExportedPath(path);
        activityService.saved(path);
        toast("Excel exportado.");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setExporting(false);
    }
  }, [state, exporting, exportExcel, toast]);

  useShortcut("o", () => void pick());

  return { state, picking, busy, exporting, exportedPath, pick, exportExcel: runExport };
}
