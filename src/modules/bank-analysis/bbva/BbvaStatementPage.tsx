import { FileSpreadsheet } from "lucide-react";
import { Button, PageHeader } from "../../../components/ui";
import { AccountDetails, StatementFileCard } from "../shared/components/StatementFileCard";
import { useStatementImport } from "../shared/useStatementImport";
import { BbvaGroupsTable } from "./components/BbvaGroupsTable";
import { BbvaSummaryCards } from "./components/BbvaSummaryCards";
import { BbvaValidationPanel } from "./components/BbvaValidationPanel";
import { analyzeBbva, type BbvaAnalysis } from "./services/analysis";
import { exportBbvaExcel } from "./services/excelExport";

const exportAnalysis = (a: BbvaAnalysis, fileName: string) => exportBbvaExcel(a.statement, a.groups, fileName);

export default function BbvaStatementPage() {
  const { state, picking, busy, exporting, exportedPath, pick, exportExcel } = useStatementImport({
    analyze: analyzeBbva,
    exportExcel: exportAnalysis,
    fallbackError: "No fue posible analizar el extracto. Verifica que sea un extracto de BBVA en PDF.",
    logTag: "bbva",
  });

  return (
    <>
      <PageHeader
        eyebrow="Extractos bancarios"
        title="BBVA"
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
        details={
          state.status === "done" && (
            <>
              <AccountDetails {...state.analysis.statement} />
              {state.analysis.statement.clientName && <span>· {state.analysis.statement.clientName}</span>}
            </>
          )
        }
        picking={picking}
        busy={busy}
        exportedPath={exportedPath}
        onPick={() => void pick()}
      />

      {state.status === "done" && (
        <>
          <BbvaValidationPanel statement={state.analysis.statement} validation={state.analysis.validation} />
          <BbvaSummaryCards summary={state.analysis.summary} finalBalanceCents={state.analysis.statement.totals.closingBalanceCents} />
          <BbvaGroupsTable groups={state.analysis.groups} />
        </>
      )}
    </>
  );
}
