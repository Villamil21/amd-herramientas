import { useCallback, useState } from "react";
import { FileSpreadsheet, FileText, FolderOpen, Upload } from "lucide-react";
import { Alert, Button, Card, PageHeader, useToast } from "../../../components/ui";
import { useShortcut } from "../../../hooks/useShortcut";
import { fileService } from "../../../services/fileService";
import { errorMessage } from "../../../services/tauri";
import { GroupsTable } from "../shared/components/GroupsTable";
import { SummaryCards } from "../shared/components/SummaryCards";
import { ValidationPanel } from "../shared/components/ValidationPanel";
import { exportStatementExcel } from "../shared/excelExportService";
import { groupMovements } from "../shared/groupingService";
import { validateStatement } from "../shared/movementValidator";
import { extractPdfText } from "../shared/pdf/pdfExtractor";
import type { PdfDocumentText } from "../shared/pdf/pdfTypes";
import { statementService } from "../shared/statementService";
import { summarize } from "../shared/summaryService";
import { StatementError, type MovementGroup, type ParsedStatement, type StatementSummary, type StatementValidation } from "../shared/types";
import { parseBancolombiaStatement } from "./parser/bancolombiaParser";

interface Analysis {
  statement: ParsedStatement;
  groups: MovementGroup[];
  summary: StatementSummary;
  validation: StatementValidation;
}

type State =
  | { status: "idle" }
  | { status: "analyzing"; fileName: string; pageCount?: number }
  | { status: "error"; fileName: string; pageCount?: number; message: string }
  | { status: "done"; fileName: string; pageCount: number; analysis: Analysis };

/** Parser → agrupación → resumen → validación, sobre el texto ya extraído. Nada se guarda. */
function analyzeStatement(text: PdfDocumentText): Analysis {
  const statement = parseBancolombiaStatement(text);
  const groups = groupMovements(statement.movements);
  const summary = summarize(statement.movements, groups);
  return { statement, groups, summary, validation: validateStatement(statement, groups, summary) };
}

export default function BancolombiaStatementPage() {
  const toast = useToast();
  const [state, setState] = useState<State>({ status: "idle" });
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const busy = picking || state.status === "analyzing";

  const pick = useCallback(async () => {
    if (busy) return;
    setPicking(true);
    try {
      const picked = await statementService.pickPdf();
      if (!picked) return;
      setExportedPath(null);
      const { fileName } = picked;
      setState({ status: "analyzing", fileName });
      let pageCount: number | undefined;
      try {
        const text = await extractPdfText(picked.data);
        pageCount = text.pageCount;
        setState({ status: "done", fileName, pageCount, analysis: analyzeStatement(text) });
      } catch (e) {
        if (!(e instanceof StatementError) && import.meta.env.DEV) console.error("[bancolombia]", e);
        const message = e instanceof StatementError ? e.message : "No fue posible analizar el extracto. Verifica que sea un extracto de Bancolombia en PDF.";
        setState({ status: "error", fileName, pageCount, message });
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
      const { statement, groups } = state.analysis;
      const path = await exportStatementExcel(statement, groups, state.fileName);
      if (path) {
        setExportedPath(path);
        toast("Excel exportado.");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setExporting(false);
    }
  }, [state, exporting, toast]);

  useShortcut("o", () => void pick());

  const pickButton = (
    <Button variant={state.status === "idle" ? "primary" : "secondary"} icon={<Upload size={15} />} onClick={() => void pick()} loading={picking} disabled={busy}>
      {state.status === "idle" ? "Seleccionar extracto PDF" : "Seleccionar otro PDF"}
    </Button>
  );

  return (
    <>
      <PageHeader
        eyebrow="Análisis de extractos bancarios"
        title="Bancolombia"
        description="Importa un extracto bancario en PDF para analizar sus movimientos."
        actions={
          state.status === "done" && (
            <Button variant="primary" icon={<FileSpreadsheet size={15} />} onClick={() => void exportExcel()} loading={exporting}>
              Exportar Excel
            </Button>
          )
        }
      />

      <Card>
        {state.status === "idle" ? (
          <div className="row row--between">
            <p className="muted">El archivo se analiza en este equipo; no se envía a ningún servicio ni se guarda una copia.</p>
            {pickButton}
          </div>
        ) : (
          <div className="stack stack--sm">
            <div className="file-chip">
              <div className="file-chip__icon">
                <FileText size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="file-chip__name selectable">{state.fileName}</div>
                <div className="muted row" style={{ fontSize: "var(--text-sm)" }}>
                  {state.pageCount !== undefined && <span>{state.pageCount === 1 ? "1 página" : `${state.pageCount} páginas`}</span>}
                  {state.status === "analyzing" && (
                    <span className="row">
                      <span className="spinner" aria-hidden /> Analizando extracto…
                    </span>
                  )}
                  {state.status === "error" && <span>No se pudo analizar</span>}
                  {state.status === "done" && state.analysis.statement.accountNumber && <span>· Cuenta {state.analysis.statement.accountNumber}</span>}
                  {state.status === "done" && state.analysis.statement.periodFrom && state.analysis.statement.periodTo && (
                    <span>
                      · {state.analysis.statement.periodFrom} a {state.analysis.statement.periodTo}
                    </span>
                  )}
                </div>
              </div>
              {exportedPath && (
                <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => void fileService.revealSaved(exportedPath).catch((e: Error) => toast(e.message, "error"))}>
                  Ver Excel en Finder
                </Button>
              )}
              {pickButton}
            </div>
            {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
          </div>
        )}
      </Card>

      {state.status === "done" && (
        <>
          <ValidationPanel statement={state.analysis.statement} validation={state.analysis.validation} />
          <SummaryCards summary={state.analysis.summary} />
          <GroupsTable groups={state.analysis.groups} />
        </>
      )}
    </>
  );
}
