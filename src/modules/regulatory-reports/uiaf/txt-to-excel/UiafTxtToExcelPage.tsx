import { useCallback, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button, PageHeader, useToast } from "../../../../components/ui";
import { useShortcut } from "../../../../hooks/useShortcut";
import { activityService, analysisStatus } from "../../../../services/activityService";
import { errorMessage } from "../../../../services/tauri";
import { formatInteger } from "../../../../utils/format";
import { StatementFileCard } from "../../../bank-analysis/shared/components/StatementFileCard";
import { StatementError } from "../../../bank-analysis/shared/types";
import type { ImportState } from "../../../bank-analysis/shared/useStatementImport";
import { UiafRecordsTable } from "./components/UiafRecordsTable";
import { UiafSummary } from "./components/UiafSummary";
import { UiafValidationPanel } from "./components/UiafValidationPanel";
import { analyzeUiafTxt } from "./services/analysis";
import { exportUiafExcel } from "./services/excelExport";
import { pickUiafTxt } from "./services/uiafFileService";
import type { UiafAnalysis } from "./types";

const LABELS = { pick: "Seleccionar archivo TXT", pickAnother: "Seleccionar otro TXT", analyzing: "Analizando archivo…" };

/** Deja que la interfaz muestre «Analizando archivo…» antes de un análisis largo. */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

export default function UiafTxtToExcelPage() {
  const toast = useToast();
  const [state, setState] = useState<ImportState<UiafAnalysis>>({ status: "idle" });
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const busy = picking || state.status === "analyzing";

  const pick = useCallback(async () => {
    if (busy) return;
    setPicking(true);
    try {
      const picked = await pickUiafTxt();
      if (!picked) return;
      setExportedPath(null);
      const { fileName } = picked;
      setState({ status: "analyzing", fileName });
      await nextFrame();
      try {
        // Un TXT no tiene páginas: pageCount 0 no se muestra.
        const analysis = analyzeUiafTxt(picked.data);
        setState({ status: "done", fileName, pageCount: 0, analysis });
        activityService.record(fileName, analysisStatus(analysis));
      } catch (e) {
        if (!(e instanceof StatementError) && import.meta.env.DEV) console.error("[uiaf]", e);
        setState({ status: "error", fileName, message: e instanceof StatementError ? e.message : "No fue posible leer el archivo. Verifica que sea un TXT de reporte UIAF." });
        activityService.record(fileName, "error");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPicking(false);
    }
  }, [busy, toast]);

  const exportExcel = useCallback(async () => {
    if (state.status !== "done" || exporting) return;
    setExporting(true);
    try {
      const path = await exportUiafExcel(state.analysis.report, state.fileName);
      if (path) {
        setExportedPath(path);
        activityService.saved(path);
        toast("Excel generado correctamente.");
      }
    } catch (e) {
      toast(errorMessage(e) || "No fue posible generar el archivo Excel.", "error");
    } finally {
      setExporting(false);
    }
  }, [state, exporting, toast]);

  useShortcut("o", () => void pick());

  const analysis = state.status === "done" ? state.analysis : undefined;
  const header = analysis?.report.header?.parsed;
  const total = analysis ? analysis.report.records.length + analysis.report.invalid.length : 0;

  return (
    <>
      <PageHeader
        eyebrow="UIAF"
        title="Conversión TXT a Excel"
        description="Convierte archivos TXT de reportes UIAF en hojas de cálculo estructuradas."
        actions={
          analysis && (
            <Button variant="primary" icon={<FileSpreadsheet size={15} />} onClick={() => void exportExcel()} loading={exporting}>
              Exportar Excel
            </Button>
          )
        }
      />

      <StatementFileCard
        state={state}
        details={
          analysis && (
            <>
              <span>{total === 1 ? "1 registro" : `${formatInteger(total)} registros`}</span>
              <span>· {analysis.validation.valid ? "Archivo válido" : "Archivo con inconsistencias"}</span>
              {header && (
                <span>
                  · Entidad {header.entityCode} · Corte {header.reportDate}
                </span>
              )}
            </>
          )
        }
        picking={picking}
        busy={busy}
        exportedPath={exportedPath}
        onPick={() => void pick()}
        labels={LABELS}
      />

      {analysis && (
        <>
          <UiafValidationPanel validation={analysis.validation} />
          <UiafSummary report={analysis.report} />
          <UiafRecordsTable key={state.status === "done" ? state.fileName + total : ""} groups={analysis.report.groups} />
        </>
      )}
    </>
  );
}
