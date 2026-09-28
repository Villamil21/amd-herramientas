import { FileSpreadsheet } from "lucide-react";
import { Button, PageHeader } from "../../../components/ui";
import { GroupsTable } from "../shared/components/GroupsTable";
import { AccountDetails, StatementFileCard } from "../shared/components/StatementFileCard";
import { SummaryCards } from "../shared/components/SummaryCards";
import { ValidationPanel } from "../shared/components/ValidationPanel";
import { exportStatementExcel } from "../shared/excelExportService";
import { groupMovements } from "../shared/groupingService";
import { validateStatement } from "../shared/movementValidator";
import type { PdfDocumentText } from "../shared/pdf/pdfTypes";
import { summarize } from "../shared/summaryService";
import type { MovementGroup, ParsedStatement, StatementSummary, StatementValidation } from "../shared/types";
import { useStatementImport } from "../shared/useStatementImport";
import { parseBancolombiaStatement } from "./parser/bancolombiaParser";

interface Analysis {
  statement: ParsedStatement;
  groups: MovementGroup[];
  summary: StatementSummary;
  validation: StatementValidation;
}

/** Parser → agrupación → resumen → validación, sobre el texto ya extraído. Nada se guarda. */
function analyzeStatement(text: PdfDocumentText): Analysis {
  const statement = parseBancolombiaStatement(text);
  const groups = groupMovements(statement.movements);
  const summary = summarize(statement.movements, groups);
  return { statement, groups, summary, validation: validateStatement(statement, groups, summary) };
}

const exportAnalysis = (a: Analysis, fileName: string) => exportStatementExcel(a.statement, a.groups, fileName);

export default function BancolombiaStatementPage() {
  const { state, picking, busy, exporting, exportedPath, pick, exportExcel } = useStatementImport({
    analyze: analyzeStatement,
    exportExcel: exportAnalysis,
    fallbackError: "No fue posible analizar el extracto. Verifica que sea un extracto de Bancolombia en PDF.",
    logTag: "bancolombia",
  });

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

      <StatementFileCard
        state={state}
        details={state.status === "done" && <AccountDetails {...state.analysis.statement} />}
        picking={picking}
        busy={busy}
        exportedPath={exportedPath}
        onPick={() => void pick()}
      />

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
